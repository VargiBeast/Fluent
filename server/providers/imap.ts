import { eq } from "drizzle-orm";
import { ImapFlow, type FetchMessageObject, type MailboxObject, type SearchObject } from "imapflow";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";
import { logger } from "../logger.js";
import { assessMessage } from "../security/phish.js";
import { htmlToText, parseAddresses } from "../gmail/parse.js";
import type { Address, DraftSummary, MessageDetail, ThreadAction, ThreadDetail, ThreadSummary } from "../../shared/mail.js";
import type { AccountRow } from "../services/accounts.js";
import { pinMailServer } from "./netGuard.js";
import type { BulkActionSpec, DraftContents, LabelsInfo, ListOptions, MailProvider, OutgoingMessage, SavedDraft, SyncResult } from "./types.js";

/** What's stored (encrypted) in accounts.credentials_enc for an IMAP account. */
export interface ImapCredentials {
  username: string;
  password: string;
  imap: { host: string; port: number };
  smtp: { host: string; port: number };
}

const CRED_PURPOSE = "mail-credentials";
const credAad = (a: Pick<AccountRow, "userId" | "googleSub">) => `${a.userId}:${a.googleSub}`;

export function sealCredentials(a: Pick<AccountRow, "userId" | "googleSub">, c: ImapCredentials): string {
  return encrypt(JSON.stringify(c), CRED_PURPOSE, credAad(a));
}

function openCredentials(a: AccountRow): ImapCredentials {
  if (!a.credentialsEnc) throw reauth(a);
  return JSON.parse(decrypt(a.credentialsEnc, CRED_PURPOSE, credAad(a))) as ImapCredentials;
}

function reauth(a: Pick<AccountRow, "email">): HttpError {
  return new HttpError(401, "account_reauth", `The mail server rejected the login for ${a.email}. Check the app password in Settings.`);
}

const TIMEOUTS = { connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000 };

/**
 * One short-lived IMAP session per request (serverless functions can't keep IMAP connections open).
 * The socket goes to the pinned, validated IP; TLS verifies the certificate for the server name.
 */
export async function withImap<T>(creds: ImapCredentials, fn: (c: ImapFlow) => Promise<T>, email = creds.username): Promise<T> {
  const t = await pinMailServer(creds.imap.host, creds.imap.port);
  const client = new ImapFlow({
    host: t.address,
    port: t.port,
    secure: !t.plaintext,
    servername: t.servername,
    doSTARTTLS: t.plaintext ? false : undefined,
    tls: { servername: t.servername, minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    disableAutoIdle: true,
    ...TIMEOUTS,
  });
  client.on("error", () => { /* surfaced through the awaited call */ });
  try {
    await client.connect();
  } catch (err) {
    const e = err as { authenticationFailed?: boolean; code?: string };
    logger.warn({ code: e.code ?? "error", auth: Boolean(e.authenticationFailed) }, "imap_connect_failed");
    if (e.authenticationFailed) throw reauth({ email });
    throw new HttpError(502, "mail_server_unavailable", "Couldn't reach the mail server. Check the server name and try again.");
  }
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Send one message over SMTP (implicit TLS on 465, STARTTLS required on 587) to the pinned IP. */
export async function smtpSend(creds: ImapCredentials, envelope: { from: string; to: string[] }, raw: string | null): Promise<void> {
  const t = await pinMailServer(creds.smtp.host, creds.smtp.port);
  const transport = nodemailer.createTransport({
    host: t.address,
    port: t.port,
    secure: !t.plaintext && creds.smtp.port === 465,
    requireTLS: !t.plaintext && creds.smtp.port === 587,
    ignoreTLS: t.plaintext,
    name: "fluent",
    tls: { servername: t.servername, minVersion: "TLSv1.2", rejectUnauthorized: true },
    auth: { user: creds.username, pass: creds.password },
    ...TIMEOUTS,
    logger: false,
  });
  try {
    if (raw === null) await transport.verify();
    else await transport.sendMail({ envelope, raw });
  } catch (err) {
    const e = err as { code?: string; responseCode?: number };
    logger.warn({ code: e.code ?? "error", smtp: e.responseCode }, "smtp_failed");
    if (e.code === "EAUTH") throw new HttpError(401, "account_reauth", "The mail server rejected the login. Check the app password.");
    throw new HttpError(502, "mail_server_unavailable", "Couldn't send through the mail server. Please try again.");
  } finally {
    transport.close();
  }
}

// ---- ids: one IMAP message is one FLUENT "thread"; the id is the mailbox code + UID ----
type Box = "inbox" | "sent" | "drafts" | "trash" | "junk" | "archive";
const CODES: Record<Box, string> = { inbox: "in", sent: "se", drafts: "dr", trash: "tr", junk: "sp", archive: "ar" };
const BOX_OF: Record<string, Box> = Object.fromEntries(Object.entries(CODES).map(([b, c]) => [c, b as Box]));
const SPECIAL: Record<string, Box> = { "\\Inbox": "inbox", "\\Sent": "sent", "\\Drafts": "drafts", "\\Trash": "trash", "\\Junk": "junk", "\\Archive": "archive" };
const FALLBACK_NAMES: Record<Box, string[]> = {
  inbox: ["INBOX"], sent: ["Sent", "Sent Messages", "Sent Items"], drafts: ["Drafts"], trash: ["Trash", "Deleted Messages", "Deleted Items"],
  junk: ["Junk", "Spam", "Bulk Mail"], archive: ["Archive", "Archived"],
};

export function encodeId(box: Box, uid: number): string {
  return `${CODES[box]}${uid}`;
}

export function decodeId(id: string): { box: Box; uid: number } {
  const m = /^(in|se|dr|tr|sp|ar)([1-9]\d{0,9})$/.exec(id);
  if (!m) throw badRequest("Invalid id");
  return { box: BOX_OF[m[1]!]!, uid: Number(m[2]) };
}

async function mailboxes(c: ImapFlow): Promise<Partial<Record<Box, string>>> {
  const list = await c.list();
  const out: Partial<Record<Box, string>> = { inbox: "INBOX" };
  for (const m of list) {
    const b = m.specialUse ? SPECIAL[m.specialUse] : undefined;
    if (b && !out[b]) out[b] = m.path;
  }
  for (const [b, names] of Object.entries(FALLBACK_NAMES) as Array<[Box, string[]]>) {
    if (!out[b]) out[b] = list.find((m) => names.some((n) => n.toLowerCase() === m.path.toLowerCase()))?.path;
  }
  return out;
}

function need(boxes: Partial<Record<Box, string>>, b: Box): string {
  const p = boxes[b];
  if (!p) throw new HttpError(400, "mailbox_missing", `This account has no ${b} folder.`);
  return p;
}

const FOLDER_BOX: Partial<Record<ListOptions["folder"], Box>> = {
  inbox: "inbox", starred: "inbox", important: "inbox", sent: "sent", drafts: "drafts", archive: "archive", spam: "junk", trash: "trash", all: "inbox",
};

/** A small, safe subset of Gmail search syntax mapped to IMAP SEARCH. */
export function imapSearch(q: string | undefined): SearchObject {
  const s: SearchObject = {};
  const text: string[] = [];
  for (const tok of (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 20)) {
    const t = tok.toLowerCase();
    if (t === "is:unread") s.seen = false;
    else if (t === "is:read") s.seen = true;
    else if (t === "is:starred" || t === "is:important") s.flagged = true; // no importance on IMAP: flagged is the closest
    else if (t.startsWith("from:") && tok.length > 5) s.from = tok.slice(5);
    else if (t.startsWith("to:") && tok.length > 3) s.to = tok.slice(3);
    else if (t.startsWith("subject:") && tok.length > 8) s.subject = tok.slice(8);
    else if (/^-?(in|is|label|category|has|newer_than|older_than):/.test(t)) continue; // Gmail-only operators are ignored
    else text.push(tok);
  }
  if (text.length) s.text = text.join(" ").slice(0, 200);
  if (!Object.keys(s).length) s.all = true;
  return s;
}

const addr = (a: { name?: string; address?: string } | undefined): Address => ({ name: a?.name || a?.address || "", email: (a?.address ?? "").toLowerCase() });
const addrList = (v: AddressObject | AddressObject[] | undefined): Address[] =>
  (Array.isArray(v) ? v : v ? [v] : []).flatMap((o) => o.value).map(addr).filter((x) => x.email);

function labelsFor(box: Box, flags: Set<string>): string[] {
  const l: string[] = [{ inbox: "INBOX", sent: "SENT", drafts: "DRAFT", trash: "TRASH", junk: "SPAM", archive: "" }[box]].filter(Boolean);
  if (!flags.has("\\Seen")) l.push("UNREAD");
  if (flags.has("\\Flagged")) l.push("STARRED");
  return l;
}

function summary(a: AccountRow, box: Box, m: FetchMessageObject): ThreadSummary {
  const env = m.envelope ?? {};
  const from = addr(env.from?.[0]);
  const to = (env.to ?? []).map(addr);
  const flags = m.flags ?? new Set<string>();
  return {
    id: encodeId(box, m.uid),
    accountId: a.id,
    subject: env.subject || "(no subject)",
    snippet: "",
    participants: [from, ...to].filter((x, i, arr) => x.email && arr.findIndex((y) => y.email === x.email) === i),
    from,
    to,
    lastDate: new Date(m.internalDate ?? env.date ?? Date.now()).toISOString(),
    messageCount: 1,
    unread: !flags.has("\\Seen"),
    starred: flags.has("\\Flagged"),
    important: false,
    hasAttachments: false,
    labelIds: labelsFor(box, flags),
    lastFromMe: from.email === a.email.toLowerCase() || box === "sent",
  };
}

function detail(a: AccountRow, box: Box, uid: number, flags: Set<string>, p: ParsedMail): MessageDetail {
  const id = encodeId(box, uid);
  const from = addrList(p.from)[0] ?? { name: "unknown", email: "" };
  const html = typeof p.html === "string" ? p.html : null;
  const text = p.text ?? (html ? htmlToText(html) : null);
  const isFromMe = from.email === a.email.toLowerCase() || box === "sent";
  const isDraft = box === "drafts" || flags.has("\\Draft");
  const replyTo = addrList(p.replyTo);
  const attachments = p.attachments.map((x, i) => ({
    attachmentId: `a${i}`, messageId: id, filename: x.filename || `attachment-${i + 1}`, mimeType: x.contentType, size: x.size,
    contentId: x.cid ?? null, inline: x.contentDisposition === "inline" && Boolean(x.cid),
  }));
  const refs = Array.isArray(p.references) ? p.references.join(" ") : (p.references ?? "");
  return {
    id, threadId: id, from, to: addrList(p.to), cc: addrList(p.cc), bcc: addrList(p.bcc), replyTo,
    date: (p.date ?? new Date()).toISOString(),
    subject: p.subject ?? "",
    messageIdHeader: p.messageId ?? "",
    references: refs,
    snippet: (text ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    bodyHtml: html,
    bodyText: text,
    attachments,
    labelIds: labelsFor(box, flags),
    unread: !flags.has("\\Seen"),
    isFromMe,
    isDraft,
    security: isFromMe || isDraft ? null : assessMessage({
      fromName: from.name, fromEmail: from.email, replyTo: replyTo.map((r) => r.email), subject: p.subject ?? "",
      text: (text ?? "").slice(0, 20_000), html: html ? html.slice(0, 200_000) : null, attachments: attachments.map((x) => x.filename),
      authResults: [p.headers.get("authentication-results")].flat().filter((v): v is string => typeof v === "string"),
    }),
  };
}

const MAX_SOURCE = 25 * 1024 * 1024;

/** Generic IMAP + SMTP. Threads are single messages; Gmail-only features report "not supported". */
export class ImapProvider implements MailProvider {
  readonly kind = "imap" as const;
  readonly capabilities = { categories: false, labels: false, filters: false, sendAs: false, importance: false };
  private creds: ImapCredentials;

  constructor(readonly account: AccountRow) {
    this.creds = openCredentials(account);
  }

  private session<T>(fn: (c: ImapFlow, boxes: Partial<Record<Box, string>>) => Promise<T>): Promise<T> {
    return withImap(this.creds, async (c) => fn(c, await mailboxes(c)), this.account.email);
  }

  async listThreads(o: ListOptions) {
    const box = FOLDER_BOX[o.folder];
    if (!box || o.folder === "snoozed") return { threads: [], nextPageToken: null };
    const offset = o.pageToken ? Number(o.pageToken) : 0;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw badRequest("Invalid cursor");
    return this.session(async (c, boxes) => {
      const path = boxes[box];
      if (!path) return { threads: [], nextPageToken: null };
      const lock = await c.getMailboxLock(path, { readOnly: true });
      try {
        const criteria = imapSearch(o.q);
        if (o.folder === "starred") criteria.flagged = true;
        const uids = ((await c.search(criteria, { uid: true })) || []).sort((x, y) => y - x);
        const page = uids.slice(offset, offset + o.limit);
        const threads: ThreadSummary[] = [];
        if (page.length) {
          for await (const m of c.fetch(page.join(","), { uid: true, envelope: true, flags: true, internalDate: true }, { uid: true })) threads.push(summary(this.account, box, m));
        }
        threads.sort((x, y) => y.lastDate.localeCompare(x.lastDate));
        return { threads, nextPageToken: offset + o.limit < uids.length ? String(offset + o.limit) : null };
      } finally {
        lock.release();
      }
    });
  }

  private async fetchOne(c: ImapFlow, boxes: Partial<Record<Box, string>>, id: string) {
    const { box, uid } = decodeId(id);
    const lock = await c.getMailboxLock(need(boxes, box), { readOnly: true });
    try {
      const m = await c.fetchOne(String(uid), { uid: true, flags: true, source: { maxLength: MAX_SOURCE } }, { uid: true });
      if (!m || !m.source) throw notFound("That email no longer exists on the server.");
      return { box, uid, flags: m.flags ?? new Set<string>(), parsed: await simpleParser(m.source, { skipImageLinks: true }) };
    } finally {
      lock.release();
    }
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const a = this.account;
    const { box, uid, flags, parsed } = await this.session((c, b) => this.fetchOne(c, b, threadId));
    const msg = detail(a, box, uid, flags, parsed);
    return {
      id: msg.id, accountId: a.id, accountEmail: a.email, subject: msg.subject || "(no subject)", labelIds: msg.labelIds,
      starred: msg.labelIds.includes("STARRED"), important: false, unread: msg.unread, inTrash: box === "trash", inInbox: box === "inbox", messages: [msg],
    };
  }

  private async apply(c: ImapFlow, boxes: Partial<Record<Box, string>>, ids: string[], action: ThreadAction): Promise<{ ok: number; failed: number }> {
    const byBox = new Map<Box, number[]>();
    for (const id of ids) {
      const d = decodeId(id);
      byBox.set(d.box, [...(byBox.get(d.box) ?? []), d.uid]);
    }
    const target: Partial<Record<ThreadAction, Box>> = { archive: "archive", inbox: "inbox", trash: "trash", untrash: "inbox", spam: "junk", notspam: "inbox" };
    const flag: Partial<Record<ThreadAction, [string, boolean]>> = { read: ["\\Seen", true], unread: ["\\Seen", false], star: ["\\Flagged", true], unstar: ["\\Flagged", false] };
    if (action === "important" || action === "unimportant") throw new HttpError(400, "not_supported_for_provider", "Importance markers are only available for Gmail accounts.");
    let ok = 0;
    let failed = 0;
    for (const [box, uids] of byBox) {
      const lock = await c.getMailboxLock(need(boxes, box));
      try {
        const range = uids.join(",");
        const f = flag[action];
        const dest = target[action];
        if (f) {
          if (f[1]) await c.messageFlagsAdd(range, [f[0]], { uid: true });
          else await c.messageFlagsRemove(range, [f[0]], { uid: true });
        } else if (dest && dest !== box) {
          await c.messageMove(range, need(boxes, dest), { uid: true });
        }
        ok += uids.length;
      } catch {
        failed += uids.length;
      } finally {
        lock.release();
      }
    }
    return { ok, failed };
  }

  async threadAction(threadId: string, action: ThreadAction): Promise<void> {
    const r = await this.session((c, b) => this.apply(c, b, [threadId], action));
    if (r.failed) throw new HttpError(502, "mail_server_error", "The mail server couldn't apply that change.");
  }

  async bulk(threadIds: string[], b: BulkActionSpec) {
    if (b.kind === "label") throw new HttpError(400, "not_supported_for_provider", "Labels are only available for Gmail accounts.");
    return this.session((c, boxes) => this.apply(c, boxes, threadIds, b.action));
  }

  async modifyLabels(): Promise<void> {
    throw new HttpError(400, "not_supported_for_provider", "Labels are only available for Gmail accounts.");
  }

  async labels(): Promise<LabelsInfo> {
    return this.session(async (c, boxes) => {
      const counts: Record<string, number> = {};
      const st = async (b: Box, key: string, field: "unseen" | "messages") => {
        const p = boxes[b];
        const r = p ? await c.status(p, { [field]: true }) : false;
        if (r) counts[key] = r[field] ?? 0;
      };
      await st("inbox", "INBOX", "unseen");
      await st("drafts", "DRAFT", "messages");
      await st("junk", "SPAM", "unseen");
      return { labels: [], counts };
    });
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const m = /^a(\d{1,3})$/.exec(attachmentId);
    if (!m) throw badRequest("Invalid attachment");
    const { parsed } = await this.session((c, b) => this.fetchOne(c, b, messageId));
    const att = parsed.attachments[Number(m[1])];
    if (!att) throw notFound("That attachment no longer exists.");
    return att.content;
  }

  async senderName() {
    return this.account.name || undefined;
  }

  async send(m: OutgoingMessage, draftId?: string) {
    const parsed = await simpleParser(m.mime);
    const rcpt = [...addrList(parsed.to), ...addrList(parsed.cc), ...addrList(parsed.bcc)].map((x) => x.email);
    if (!rcpt.length) throw badRequest("Add at least one recipient");
    // Bcc must not travel in the delivered message; the envelope carries it.
    const delivered = m.mime.replace(/^Bcc:.*(?:\r\n[ \t].*)*\r\n/im, "");
    await smtpSend(this.creds, { from: this.account.email, to: rcpt }, delivered);
    // Keep a copy in Sent and drop the draft. Best-effort: the email is already sent.
    let id = "";
    await this.session(async (c, boxes) => {
      if (boxes.sent) {
        const r = await c.append(boxes.sent, delivered, ["\\Seen"]);
        if (r && typeof r === "object" && r.uid) id = encodeId("sent", r.uid);
      }
      if (draftId) await this.removeDraft(c, boxes, draftId);
    }).catch((err: unknown) => logger.warn({ code: err instanceof HttpError ? err.code : "error" }, "imap_post_send_failed"));
    return { id, threadId: id };
  }

  private async removeDraft(c: ImapFlow, boxes: Partial<Record<Box, string>>, draftId: string) {
    const { box, uid } = decodeId(draftId);
    if (box !== "drafts") throw badRequest("Invalid draft");
    const lock = await c.getMailboxLock(need(boxes, "drafts"));
    try {
      await c.messageDelete(String(uid), { uid: true });
    } finally {
      lock.release();
    }
  }

  async saveDraft(m: OutgoingMessage, draftId?: string): Promise<SavedDraft> {
    return this.session(async (c, boxes) => {
      const r = await c.append(need(boxes, "drafts"), m.mime, ["\\Draft", "\\Seen"]);
      if (!r || typeof r !== "object" || !r.uid) throw new HttpError(502, "mail_server_error", "The mail server didn't confirm the saved draft.");
      if (draftId) await this.removeDraft(c, boxes, draftId).catch(() => undefined);
      const id = encodeId("drafts", r.uid);
      return { draftId: id, messageId: id, threadId: id };
    });
  }

  async getDraft(draftId: string): Promise<DraftContents> {
    if (decodeId(draftId).box !== "drafts") throw badRequest("Invalid draft");
    const { uid, flags, parsed } = await this.session((c, b) => this.fetchOne(c, b, draftId));
    const refs = Array.isArray(parsed.references) ? parsed.references.join(" ") : (parsed.references ?? null);
    return { draftId, message: detail(this.account, "drafts", uid, flags, parsed), inReplyTo: parsed.inReplyTo ?? null, references: refs };
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.session((c, b) => this.removeDraft(c, b, draftId));
  }

  async listDrafts(): Promise<DraftSummary[]> {
    const r = await this.listThreads({ folder: "drafts", limit: 50 });
    return r.threads.map((t) => ({ draftId: t.id, messageId: t.id, threadId: t.id, accountId: this.account.id, to: t.to, subject: t.subject, snippet: "", date: t.lastDate }));
  }

  /** Change detection from INBOX UIDNEXT/message count, kept in accounts.history_id as "uidValidity:uidNext:count". */
  async sync(): Promise<SyncResult> {
    const st = (await withImap(this.creds, (c) => c.status("INBOX", { uidNext: true, uidValidity: true, messages: true }), this.account.email)) || {} as { uidValidity?: bigint; uidNext?: number; messages?: number };
    const now = `${st.uidValidity ?? 0}:${st.uidNext ?? 0}:${st.messages ?? 0}`;
    const prev = this.account.historyId;
    await getDb().update(accounts).set({ historyId: now, lastSyncedAt: new Date() }).where(eq(accounts.id, this.account.id));
    if (!prev) return { changed: false, newInbox: 0 };
    const [pv, pn] = prev.split(":");
    const newInbox = pv === String(st.uidValidity ?? 0) ? Math.max(0, Number(st.uidNext ?? 0) - Number(pn)) : 0;
    return { changed: prev !== now, newInbox };
  }
}

export type { MailboxObject };
export { parseAddresses };
