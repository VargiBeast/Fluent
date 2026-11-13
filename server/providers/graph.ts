import { eq } from "drizzle-orm";
import { simpleParser } from "mailparser";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { microsoftEndpoints } from "../env.js";
import { refreshMicrosoftToken } from "../auth/microsoft.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { logger } from "../logger.js";
import type { Address, DraftSummary, ThreadAction, ThreadDetail, ThreadSummary } from "../../shared/mail.js";
import type { AccountRow } from "../services/accounts.js";
import { mimeDetail } from "./imap.js";
import type { BulkActionSpec, DraftContents, LabelsInfo, ListOptions, MailProvider, OutgoingMessage, SavedDraft, SyncResult } from "./types.js";

/**
 * Graph ids are base64 ("+", "/", "=") and up to ~200 chars. MailIQ ids use "." and "~" for "+" and "/"
 * so they stay URL-path safe; the original is restored (and percent-encoded) before every Graph call.
 */
export const GRAPH_ID = /^[A-Za-z0-9_=.~-]{1,256}$/;
export const toFluentId = (graphId: string): string => graphId.replace(/\+/g, ".").replace(/\//g, "~");
export function toGraphId(id: string, what = "id"): string {
  if (!GRAPH_ID.test(id)) throw badRequest(`Invalid ${what}`);
  return encodeURIComponent(id.replace(/\./g, "+").replace(/~/g, "/"));
}

type Query = Record<string, string | number | undefined>;

/** Graph REST client for one Outlook account: bearer token from the encrypted row, refreshed on expiry or 401. */
export class GraphClient {
  private token: string | null = null;

  constructor(readonly account: AccountRow) {}

  private aad(): string {
    return `${this.account.userId}:${this.account.googleSub}`;
  }

  private reauth(): HttpError {
    return new HttpError(401, "account_reauth", `Access to ${this.account.email} expired or was revoked. Reconnect the account in Settings.`);
  }

  private async accessToken(force = false): Promise<string> {
    const a = this.account;
    if (a.status === "insufficient_scopes") throw new HttpError(403, "insufficient_scopes", `MailIQ doesn't have mail access for ${a.email}. Reconnect and allow the mail permissions.`);
    if (!force && this.token) return this.token;
    if (!force && a.accessTokenEnc && a.accessTokenExpiresAt && a.accessTokenExpiresAt.getTime() > Date.now() + 30_000) {
      this.token = decrypt(a.accessTokenEnc, "token", this.aad());
      return this.token;
    }
    if (!a.refreshTokenEnc) throw this.reauth();
    try {
      const t = await refreshMicrosoftToken(decrypt(a.refreshTokenEnc, "token", this.aad()));
      const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
      const enc = encrypt(t.access_token, "token", this.aad());
      // Microsoft rotates refresh tokens: always keep the newest one.
      await getDb().update(accounts).set({
        accessTokenEnc: enc, accessTokenExpiresAt: expiresAt, status: "active", updatedAt: new Date(),
        ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token, "token", this.aad()) } : {}),
      }).where(eq(accounts.id, a.id));
      a.accessTokenEnc = enc;
      a.accessTokenExpiresAt = expiresAt;
      this.token = t.access_token;
      return this.token;
    } catch (err) {
      if (err instanceof HttpError && err.code === "invalid_grant") {
        await getDb().update(accounts).set({ status: "needs_reauth", updatedAt: new Date() }).where(eq(accounts.id, a.id));
        a.status = "needs_reauth";
        throw this.reauth();
      }
      throw err;
    }
  }

  /** `path` is relative to the Graph base, or an absolute nextLink/deltaLink that must stay on that base. */
  async request<T>(method: string, path: string, opts: { query?: Query; json?: unknown; mime?: string; raw?: boolean } = {}): Promise<T> {
    const base = microsoftEndpoints().graph;
    const url = new URL(path.startsWith("https://") || path.startsWith("http://") ? path : `${base}${path}`);
    if (!url.href.startsWith(`${base}/`)) throw new HttpError(502, "graph_bad_link", "Outlook returned an unexpected link.");
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { prefer: 'IdType="ImmutableId"' };
    let body: string | undefined;
    if (opts.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(opts.json); }
    if (opts.mime !== undefined) { headers["content-type"] = "text/plain"; body = Buffer.from(opts.mime).toString("base64"); }
    let attempt = 0;
    let forced = false;
    for (;;) {
      const res = await fetch(url, { method, headers: { ...headers, authorization: `Bearer ${await this.accessToken(forced)}` }, body, signal: AbortSignal.timeout(20000) });
      if (res.status === 401 && !forced) { forced = true; this.token = null; continue; }
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 2) {
        attempt++;
        const after = Math.min(Number(res.headers.get("retry-after")) || 0, 5);
        await new Promise((r) => setTimeout(r, after ? after * 1000 : 300 * 2 ** attempt + Math.random() * 200));
        continue;
      }
      if (res.status === 202 || res.status === 204) return undefined as T;
      if (!res.ok) {
        let code = "";
        try { code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? ""; } catch { /* ignore */ }
        logger.warn({ graphStatus: res.status, code: code.slice(0, 60), method, path: url.pathname.replace(/\/[A-Za-z0-9_=%.~-]{20,}/g, "/:id") }, "graph_error");
        if (res.status === 404) throw notFound("That email no longer exists in Outlook.");
        if (res.status === 401) throw this.reauth();
        if (res.status === 403) throw new HttpError(403, "graph_forbidden", "Outlook refused this action for the connected account.");
        if (res.status === 429) throw new HttpError(429, "graph_rate_limited", "Outlook is rate limiting requests. Please wait a moment.");
        if (res.status === 400 || res.status === 409) throw new HttpError(400, "graph_bad_request", "Outlook rejected the request.");
        throw new HttpError(502, "graph_unavailable", "Outlook is temporarily unavailable. Please try again.");
      }
      return (opts.raw ? Buffer.from(await res.arrayBuffer()) : await res.json()) as T;
    }
  }
}

interface GraphRecipient { emailAddress?: { name?: string; address?: string } }
interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  importance?: "low" | "normal" | "high";
  flag?: { flagStatus?: string };
  hasAttachments?: boolean;
  parentFolderId?: string;
  "@removed"?: unknown;
}
interface Page<T> { value: T[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }

const SELECT = "id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,isDraft,importance,flag,hasAttachments,parentFolderId";
type WellKnown = "inbox" | "sentitems" | "drafts" | "archive" | "junkemail" | "deleteditems";
const FOLDER_WK: Partial<Record<ListOptions["folder"], WellKnown>> = {
  inbox: "inbox", starred: "inbox", important: "inbox", sent: "sentitems", drafts: "drafts", archive: "archive", spam: "junkemail", trash: "deleteditems",
};
const LABEL_OF: Record<WellKnown, string> = { inbox: "INBOX", sentitems: "SENT", drafts: "DRAFT", archive: "", junkemail: "SPAM", deleteditems: "TRASH" };
const MOVE: Partial<Record<ThreadAction, WellKnown>> = { archive: "archive", inbox: "inbox", trash: "deleteditems", untrash: "inbox", spam: "junkemail", notspam: "inbox" };
const MAX_MIME = 25 * 1024 * 1024;

const addr = (r: GraphRecipient | undefined): Address => ({ name: r?.emailAddress?.name || r?.emailAddress?.address || "", email: (r?.emailAddress?.address ?? "").toLowerCase() });

/** MailIQ search syntax mapped onto Graph: is:/from: become OData filters; other text is a KQL $search. */
export function graphQuery(q: string | undefined, folder: ListOptions["folder"]): { filter: string[]; search: string | null } {
  const filter: string[] = [];
  const text: string[] = [];
  if (folder === "starred") filter.push("flag/flagStatus eq 'flagged'");
  if (folder === "important") filter.push("importance eq 'high'");
  for (const tok of (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 20)) {
    const t = tok.toLowerCase();
    if (t === "is:unread") filter.push("isRead eq false");
    else if (t === "is:read") filter.push("isRead eq true");
    else if (t === "is:starred") filter.push("flag/flagStatus eq 'flagged'");
    else if (t === "is:important") filter.push("importance eq 'high'");
    else if (/^(from|to|subject):./.test(t)) text.push(`${t.split(":")[0]}:${tok.slice(tok.indexOf(":") + 1)}`);
    else if (/^-?(in|is|label|category|has|newer_than|older_than):/.test(t)) continue; // Gmail-only operators are ignored
    else text.push(tok);
  }
  // KQL inside a quoted $search: strip quotes/backslashes so user text can't break out of the string.
  const search = text.join(" ").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return { filter: [...new Set(filter)], search: search || null };
}

function matches(m: GraphMessage, filter: string[]): boolean {
  return filter.every((f) =>
    f === "isRead eq false" ? !m.isRead : f === "isRead eq true" ? Boolean(m.isRead)
      : f === "flag/flagStatus eq 'flagged'" ? m.flag?.flagStatus === "flagged" : f === "importance eq 'high'" ? m.importance === "high" : true);
}

/** Outlook / Microsoft 365 over Microsoft Graph. Threads are single messages, like IMAP. */
export class GraphProvider implements MailProvider {
  readonly kind = "outlook" as const;
  readonly capabilities = { categories: false, labels: false, filters: false, sendAs: false, importance: true };
  private g: GraphClient;
  private folderIds: Promise<Map<string, WellKnown>> | null = null;

  constructor(readonly account: AccountRow) {
    this.g = new GraphClient(account);
  }

  /** parentFolderId -> well-known name, to tell inbox/trash/... apart. One small batch per request. */
  private wellKnownIds(): Promise<Map<string, WellKnown>> {
    this.folderIds ??= Promise.all((Object.keys(LABEL_OF) as WellKnown[]).map(async (wk) => {
      try { return [(await this.g.request<{ id: string }>("GET", `/me/mailFolders/${wk}`, { query: { $select: "id" } })).id, wk] as const; } catch { return null; }
    })).then((r) => new Map(r.filter((x): x is readonly [string, WellKnown] => Boolean(x))));
    return this.folderIds;
  }

  private labels_(m: GraphMessage, wk: WellKnown | undefined): string[] {
    const l = [wk ? LABEL_OF[wk] : ""].filter(Boolean);
    if (!m.isRead) l.push("UNREAD");
    if (m.flag?.flagStatus === "flagged") l.push("STARRED");
    if (m.importance === "high") l.push("IMPORTANT");
    return l;
  }

  private summary(m: GraphMessage, wk: WellKnown | undefined): ThreadSummary {
    const from = addr(m.from);
    const to = (m.toRecipients ?? []).map(addr);
    const id = toFluentId(m.id);
    return {
      id, accountId: this.account.id, subject: m.subject || "(no subject)", snippet: (m.bodyPreview ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      participants: [from, ...to].filter((x, i, arr) => x.email && arr.findIndex((y) => y.email === x.email) === i), from, to,
      lastDate: new Date(m.receivedDateTime ?? Date.now()).toISOString(), messageCount: 1, unread: !m.isRead,
      starred: m.flag?.flagStatus === "flagged", important: m.importance === "high", hasAttachments: Boolean(m.hasAttachments),
      labelIds: this.labels_(m, wk), lastFromMe: from.email === this.account.email.toLowerCase() || wk === "sentitems",
    };
  }

  async listThreads(o: ListOptions) {
    if (o.folder === "snoozed") return { threads: [], nextPageToken: null };
    const wk = FOLDER_WK[o.folder];
    const offset = o.pageToken ? Number(o.pageToken) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw badRequest("Invalid cursor");
    const { filter, search } = graphQuery(o.q, o.folder);
    const path = wk ? `/me/mailFolders/${wk}/messages` : "/me/messages";
    let msgs: GraphMessage[];
    let more = false;
    if (search) {
      // Graph can't combine $search with $filter/$skip/$orderby on messages: one relevance-ranked page, filtered here.
      const r = await this.g.request<Page<GraphMessage>>("GET", path, { query: { $search: `"${search}"`, $top: 50, $select: SELECT } });
      msgs = r.value.filter((m) => matches(m, filter)).slice(0, o.limit);
    } else {
      const r = await this.g.request<Page<GraphMessage>>("GET", path, {
        query: { $top: o.limit, $skip: offset || undefined, $select: SELECT, $orderby: "receivedDateTime desc", $filter: filter.length ? filter.join(" and ") : undefined },
      });
      msgs = r.value;
      more = Boolean(r["@odata.nextLink"]);
    }
    const ids = wk ? null : await this.wellKnownIds();
    const threads = msgs.map((m) => this.summary(m, wk ?? ids?.get(m.parentFolderId ?? "")));
    return { threads, nextPageToken: more ? String(offset + o.limit) : null };
  }

  private async fetchFull(id: string) {
    const gid = toGraphId(id);
    const [meta, mime, ids] = await Promise.all([
      this.g.request<GraphMessage>("GET", `/me/messages/${gid}`, { query: { $select: SELECT } }),
      this.g.request<Buffer>("GET", `/me/messages/${gid}/$value`, { raw: true }),
      this.wellKnownIds(),
    ]);
    if (mime.length > MAX_MIME) throw new HttpError(413, "message_too_large", "This email is too large to open in MailIQ.");
    const wk = ids.get(meta.parentFolderId ?? "");
    const parsed = await simpleParser(mime, { skipImageLinks: true });
    const msg = mimeDetail(this.account, toFluentId(meta.id), { labelIds: this.labels_(meta, wk), unread: !meta.isRead, sent: wk === "sentitems", draft: Boolean(meta.isDraft) || wk === "drafts" }, parsed);
    return { meta, wk, parsed, msg };
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const { meta, wk, msg } = await this.fetchFull(threadId);
    const a = this.account;
    return {
      id: msg.id, accountId: a.id, accountEmail: a.email, subject: msg.subject || "(no subject)", labelIds: msg.labelIds,
      starred: meta.flag?.flagStatus === "flagged", important: meta.importance === "high", unread: msg.unread,
      inTrash: wk === "deleteditems", inInbox: wk === "inbox", messages: [msg],
    };
  }

  private async apply(id: string, action: ThreadAction): Promise<void> {
    const gid = toGraphId(id);
    const patch: Partial<Record<ThreadAction, unknown>> = {
      read: { isRead: true }, unread: { isRead: false },
      star: { flag: { flagStatus: "flagged" } }, unstar: { flag: { flagStatus: "notFlagged" } },
      important: { importance: "high" }, unimportant: { importance: "normal" },
    };
    if (patch[action]) await this.g.request("PATCH", `/me/messages/${gid}`, { json: patch[action] });
    else if (MOVE[action]) await this.g.request("POST", `/me/messages/${gid}/move`, { json: { destinationId: MOVE[action] } });
    else throw badRequest("Unsupported action");
  }

  async threadAction(threadId: string, action: ThreadAction): Promise<void> {
    await this.apply(threadId, action);
  }

  async bulk(threadIds: string[], b: BulkActionSpec) {
    if (b.kind === "label") throw new HttpError(400, "not_supported_for_provider", "Labels are only available for Gmail accounts.");
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < threadIds.length; i += 4) {
      const r = await Promise.allSettled(threadIds.slice(i, i + 4).map((id) => this.apply(id, b.action)));
      for (const x of r) if (x.status === "fulfilled") ok++; else failed++;
    }
    return { ok, failed };
  }

  async modifyLabels(): Promise<void> {
    throw new HttpError(400, "not_supported_for_provider", "Labels are only available for Gmail accounts.");
  }

  async labels(): Promise<LabelsInfo> {
    const get = (wk: WellKnown) => this.g.request<{ unreadItemCount?: number; totalItemCount?: number }>("GET", `/me/mailFolders/${wk}`, { query: { $select: "unreadItemCount,totalItemCount" } }).catch(() => ({} as { unreadItemCount?: number; totalItemCount?: number }));
    const [inbox, drafts, junk] = await Promise.all([get("inbox"), get("drafts"), get("junkemail")]);
    return { labels: [], counts: { INBOX: inbox.unreadItemCount ?? 0, DRAFT: drafts.totalItemCount ?? 0, SPAM: junk.unreadItemCount ?? 0 } };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const m = /^a(\d{1,3})$/.exec(attachmentId);
    if (!m) throw badRequest("Invalid attachment");
    const mime = await this.g.request<Buffer>("GET", `/me/messages/${toGraphId(messageId)}/$value`, { raw: true });
    const att = (await simpleParser(mime, { skipImageLinks: true })).attachments[Number(m[1])];
    if (!att) throw notFound("That attachment no longer exists.");
    return att.content;
  }

  async senderName() {
    return this.account.name || undefined;
  }

  /** Graph sends the MIME as-is (Bcc is taken from the header and not delivered) and files it in Sent Items. */
  async send(m: OutgoingMessage, draftId?: string) {
    await this.g.request("POST", "/me/sendMail", { mime: m.mime });
    if (draftId) await this.deleteDraft(draftId).catch((err: unknown) => logger.warn({ code: err instanceof HttpError ? err.code : "error" }, "graph_post_send_failed"));
    return { id: "", threadId: m.threadId ?? "" };
  }

  async saveDraft(m: OutgoingMessage, draftId?: string): Promise<SavedDraft> {
    const created = await this.g.request<GraphMessage>("POST", "/me/messages", { mime: m.mime });
    if (draftId) await this.deleteDraft(draftId).catch(() => undefined);
    const id = toFluentId(created.id);
    return { draftId: id, messageId: id, threadId: id };
  }

  async getDraft(draftId: string): Promise<DraftContents> {
    const { meta, parsed, msg } = await this.fetchFull(draftId);
    if (!meta.isDraft) throw badRequest("Invalid draft");
    const refs = Array.isArray(parsed.references) ? parsed.references.join(" ") : (parsed.references ?? null);
    return { draftId, message: msg, inReplyTo: parsed.inReplyTo ?? null, references: refs };
  }

  async deleteDraft(draftId: string): Promise<void> {
    const gid = toGraphId(draftId);
    const meta = await this.g.request<GraphMessage>("GET", `/me/messages/${gid}`, { query: { $select: "id,isDraft" } });
    if (!meta.isDraft) throw badRequest("Invalid draft"); // never delete a real email through the drafts API
    await this.g.request("DELETE", `/me/messages/${gid}`);
  }

  async listDrafts(): Promise<DraftSummary[]> {
    const r = await this.listThreads({ folder: "drafts", limit: 50 });
    return r.threads.map((t) => ({ draftId: t.id, messageId: t.id, threadId: t.id, accountId: this.account.id, to: t.to, subject: t.subject, snippet: t.snippet, date: t.lastDate }));
  }

  /**
   * Change detection with a Graph delta query on the Inbox, kept in accounts.history_id as "delta:<deltaLink>".
   * The first call only establishes the link (scoped to the last day so it's a page or two).
   */
  async sync(): Promise<SyncResult> {
    const prev = this.account.historyId?.startsWith("delta:") ? this.account.historyId.slice(6) : null;
    const since = this.account.lastSyncedAt ?? new Date(0);
    let link: string = prev ?? "/me/mailFolders/inbox/messages/delta";
    let query: Query | undefined = prev ? undefined : { $select: "id,receivedDateTime,isRead", $filter: `receivedDateTime ge ${new Date(Date.now() - 86_400_000).toISOString()}` };
    let changed = false;
    let newInbox = 0;
    let delta: string | undefined;
    for (let page = 0; page < 10 && !delta; page++) {
      let r: Page<GraphMessage & { receivedDateTime?: string }>;
      try {
        r = await this.g.request("GET", link, { query });
      } catch (err) {
        // Expired/invalid delta token: start over next time.
        if (prev && err instanceof HttpError && (err.status === 400 || err.status === 404 || err.status === 410)) {
          await getDb().update(accounts).set({ historyId: null }).where(eq(accounts.id, this.account.id));
          return { changed: true, newInbox: 0 };
        }
        throw err;
      }
      query = undefined;
      if (prev) for (const m of r.value) {
        changed = true;
        if (!m["@removed"] && m.receivedDateTime && new Date(m.receivedDateTime) > since && !m.isRead) newInbox++;
      }
      delta = r["@odata.deltaLink"];
      if (!delta && r["@odata.nextLink"]) link = r["@odata.nextLink"];
      else if (!delta) break;
    }
    await getDb().update(accounts).set({ ...(delta ? { historyId: `delta:${delta}` } : {}), lastSyncedAt: new Date() }).where(eq(accounts.id, this.account.id));
    return { changed: prev ? changed : false, newInbox };
  }
}
