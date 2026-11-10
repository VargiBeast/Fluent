import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { GmailClient, mapLimit } from "../gmail/client.js";
import { toBase64Url } from "../gmail/mime.js";
import { decodeB64Url, parseMessage, summarizeThread, type GmailMessage, type GmailThread } from "../gmail/parse.js";
import type { Category, DraftSummary, GmailLabel, ThreadAction, ThreadDetail } from "../../shared/mail.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { senderDisplayName } from "../services/sendas.js";
import type { AccountRow } from "../services/accounts.js";
import type { BulkActionSpec, DraftContents, LabelsInfo, ListOptions, MailProvider, OutgoingMessage, SavedDraft, SyncResult } from "./types.js";

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date"];
export const MAIL_ID = /^[A-Za-z0-9_=.~-]{1,256}$/;

export function assertMailId(id: string, what = "id"): string {
  if (!MAIL_ID.test(id)) throw badRequest(`Invalid ${what}`);
  return id;
}

/** Gmail's own ids are stricter than the cross-provider format. */
const GMAIL_NATIVE_ID = /^[A-Za-z0-9_-]{1,128}$/;
function gmailId(id: string, what = "id"): string {
  if (!GMAIL_NATIVE_ID.test(id)) throw badRequest(`Invalid ${what}`);
  return id;
}

const CATEGORY_LABEL: Record<Category, string> = {
  primary: "CATEGORY_PERSONAL",
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

export function folderQuery(folder: ListOptions["folder"], category?: Category, labelId?: string): { labelIds: string[]; q: string; includeSpamTrash: boolean } {
  if (labelId) return { labelIds: [gmailId(labelId, "label")], q: "", includeSpamTrash: false };
  switch (folder) {
    case "inbox": return { labelIds: ["INBOX", ...(category ? [CATEGORY_LABEL[category]] : [])], q: "", includeSpamTrash: false };
    case "starred": return { labelIds: ["STARRED"], q: "", includeSpamTrash: false };
    case "snoozed": return { labelIds: [], q: "label:snoozed", includeSpamTrash: false };
    case "important": return { labelIds: ["IMPORTANT"], q: "", includeSpamTrash: false };
    case "sent": return { labelIds: ["SENT"], q: "", includeSpamTrash: false };
    case "drafts": return { labelIds: ["DRAFT"], q: "", includeSpamTrash: false };
    case "archive": return { labelIds: [], q: "-in:inbox -in:spam -in:trash -in:drafts -in:sent -in:chats", includeSpamTrash: false };
    case "spam": return { labelIds: ["SPAM"], q: "", includeSpamTrash: true };
    case "trash": return { labelIds: ["TRASH"], q: "", includeSpamTrash: true };
    case "all": return { labelIds: [], q: "", includeSpamTrash: false };
  }
}

const ACTIONS: Record<ThreadAction, { add?: string[]; remove?: string[]; trash?: boolean; untrash?: boolean }> = {
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  read: { remove: ["UNREAD"] },
  unread: { add: ["UNREAD"] },
  archive: { remove: ["INBOX"] },
  inbox: { add: ["INBOX"], remove: ["SPAM"] },
  important: { add: ["IMPORTANT"] },
  unimportant: { remove: ["IMPORTANT"] },
  trash: { trash: true },
  untrash: { untrash: true },
  spam: { add: ["SPAM"], remove: ["INBOX"] },
  notspam: { add: ["INBOX"], remove: ["SPAM"] },
};

const SYSTEM_MUTABLE = new Set(["STARRED", "UNREAD", "IMPORTANT", "INBOX"]);

/** Gmail REST implementation. This is the code that lived in services/mail.ts and routes/compose.ts, unchanged in behaviour. */
export class GmailProvider implements MailProvider {
  readonly kind = "gmail" as const;
  readonly capabilities = { categories: true, labels: true, filters: true, sendAs: true, importance: true };
  readonly gm: GmailClient;

  constructor(readonly account: AccountRow) {
    this.gm = new GmailClient(account);
  }

  async listThreads(o: ListOptions) {
    const fq = folderQuery(o.folder, o.category, o.label);
    const q = [fq.q, o.q?.trim()].filter(Boolean).join(" ");
    const list = await this.gm.request<{ threads?: Array<{ id: string }>; nextPageToken?: string }>("GET", "/threads", {
      query: { labelIds: fq.labelIds, q: q || undefined, maxResults: o.limit, pageToken: o.pageToken, includeSpamTrash: fq.includeSpamTrash || undefined },
    });
    const threads = await mapLimit(list.threads ?? [], 8, (t) =>
      this.gm.request<GmailThread>("GET", `/threads/${t.id}`, { query: { format: "metadata", metadataHeaders: META_HEADERS } }).catch(() => null),
    );
    return {
      threads: threads.filter((t): t is GmailThread => t !== null).map((t) => summarizeThread(t, this.account.id, this.account.email)),
      nextPageToken: list.nextPageToken ?? null,
    };
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const a = this.account;
    const t = await this.gm.request<GmailThread>("GET", `/threads/${gmailId(threadId)}`, { query: { format: "full" } });
    const messages = (t.messages ?? []).map((m) => parseMessage(m, a.email));
    const labelIds = [...new Set(messages.flatMap((m) => m.labelIds))];
    const firstReal = messages.find((m) => !m.isDraft) ?? messages[0];
    return {
      id: t.id,
      accountId: a.id,
      accountEmail: a.email,
      subject: firstReal?.subject || "(no subject)",
      labelIds,
      starred: labelIds.includes("STARRED"),
      important: labelIds.includes("IMPORTANT"),
      unread: messages.some((m) => m.unread),
      inTrash: labelIds.includes("TRASH"),
      inInbox: labelIds.includes("INBOX"),
      messages,
    };
  }

  async threadAction(threadId: string, action: ThreadAction): Promise<void> {
    const id = gmailId(threadId);
    const spec = ACTIONS[action];
    if (spec.trash) return void (await this.gm.request("POST", `/threads/${id}/trash`));
    if (spec.untrash) return void (await this.gm.request("POST", `/threads/${id}/untrash`));
    await this.gm.request("POST", `/threads/${id}/modify`, { body: { addLabelIds: spec.add ?? [], removeLabelIds: spec.remove ?? [] } });
  }

  /** Label changes use one messages.batchModify (all message ids of the threads); trash uses threads.trash (no batch trash). */
  async bulk(threadIds: string[], b: BulkActionSpec) {
    let ok = 0;
    let failed = 0;
    if (b.kind === "action" && (b.action === "trash" || b.action === "untrash")) {
      await mapLimit(threadIds, 5, async (id) => {
        try { await this.gm.request("POST", `/threads/${id}/${b.action}`); ok++; } catch { failed++; }
      });
      return { ok, failed };
    }
    if (b.kind === "label") {
      const { labels } = await this.gm.request<{ labels?: Array<{ id: string; type: string }> }>("GET", "/labels");
      if (!(labels ?? []).some((l) => l.id === b.labelId && l.type === "user")) throw badRequest("Unknown label");
    }
    const spec = b.kind === "label" ? (b.add ? { add: [b.labelId] } : { remove: [b.labelId] }) : ACTIONS[b.action];
    const msgIds: string[] = [];
    await mapLimit(threadIds, 5, async (id) => {
      try {
        const t = await this.gm.request<{ messages?: Array<{ id: string }> }>("GET", `/threads/${id}`, { query: { format: "minimal" } });
        msgIds.push(...(t.messages ?? []).map((m) => m.id));
        ok++;
      } catch { failed++; }
    });
    for (let i = 0; i < msgIds.length; i += 1000) {
      await this.gm.request("POST", "/messages/batchModify", { body: { ids: msgIds.slice(i, i + 1000), addLabelIds: spec.add ?? [], removeLabelIds: spec.remove ?? [] } });
    }
    return { ok, failed };
  }

  async modifyLabels(threadId: string, add: string[], remove: string[]): Promise<void> {
    const { labels } = await this.gm.request<{ labels?: Array<{ id: string; type: string }> }>("GET", "/labels");
    const userLabels = new Set((labels ?? []).filter((l) => l.type === "user").map((l) => l.id));
    for (const l of [...add, ...remove]) {
      if (!userLabels.has(l) && !SYSTEM_MUTABLE.has(l)) throw badRequest("Unknown label");
    }
    await this.gm.request("POST", `/threads/${gmailId(threadId)}/modify`, { body: { addLabelIds: add, removeLabelIds: remove } });
  }

  async labels(): Promise<LabelsInfo> {
    const { labels } = await this.gm.request<{ labels?: Array<{ id: string; name: string; type: string; color?: GmailLabel["color"] }> }>("GET", "/labels");
    const counted = await mapLimit(["INBOX", "DRAFT", "SPAM", "STARRED", "IMPORTANT"], 5, (id) =>
      this.gm.request<{ id: string; threadsUnread?: number; threadsTotal?: number }>("GET", `/labels/${id}`).catch(() => null),
    );
    const counts: Record<string, number> = {};
    for (const c of counted) {
      if (!c) continue;
      counts[c.id] = c.id === "DRAFT" ? (c.threadsTotal ?? 0) : (c.threadsUnread ?? 0);
    }
    return {
      labels: (labels ?? [])
        .filter((l) => l.type === "user")
        .map((l) => ({ id: l.id, name: l.name, type: "user" as const, color: l.color ?? null }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      counts,
    };
  }

  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const r = await this.gm.request<{ data?: string }>("GET", `/messages/${gmailId(messageId)}/attachments/${gmailId(attachmentId.slice(0, 128), "attachment")}`);
    return decodeB64Url(r.data ?? "");
  }

  senderName() {
    return senderDisplayName(this.gm);
  }

  async send(m: OutgoingMessage, draftId?: string) {
    const raw = toBase64Url(m.mime);
    if (draftId) {
      await this.gm.request("PUT", `/drafts/${draftId}`, { body: { id: draftId, message: { raw, threadId: m.threadId } } });
      return this.gm.request<{ id: string; threadId: string }>("POST", "/drafts/send", { body: { id: draftId } });
    }
    return this.gm.request<{ id: string; threadId: string }>("POST", "/messages/send", { body: { raw, threadId: m.threadId } });
  }

  async saveDraft(m: OutgoingMessage, draftId?: string): Promise<SavedDraft> {
    const message = { raw: toBase64Url(m.mime), threadId: m.threadId };
    const r = draftId
      ? await this.gm.request<{ id: string; message: { id: string; threadId: string } }>("PUT", `/drafts/${draftId}`, { body: { id: draftId, message } })
      : await this.gm.request<{ id: string; message: { id: string; threadId: string } }>("POST", "/drafts", { body: { message } });
    return { draftId: r.id, messageId: r.message.id, threadId: r.message.threadId };
  }

  async getDraft(draftId: string): Promise<DraftContents> {
    const d = await this.gm.request<{ id: string; message: GmailMessage }>("GET", `/drafts/${draftId}`, { query: { format: "full" } });
    const header = (n: string) => d.message.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
    return { draftId: d.id, message: parseMessage(d.message, this.account.email), inReplyTo: header("in-reply-to") ?? null, references: header("references") ?? null };
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.gm.request("DELETE", `/drafts/${draftId}`);
  }

  async listDrafts(): Promise<DraftSummary[]> {
    const a = this.account;
    const r = await this.gm.request<{ drafts?: Array<{ id: string; message: { id: string; threadId: string } }> }>("GET", "/drafts", { query: { maxResults: 50 } });
    const full = await mapLimit(r.drafts ?? [], 8, (d) => this.gm.request<{ id: string; message: GmailMessage }>("GET", `/drafts/${d.id}`, { query: { format: "full" } }).catch(() => null));
    return full.filter((d): d is { id: string; message: GmailMessage } => d !== null).map((d) => {
      const m = parseMessage(d.message, a.email);
      return { draftId: d.id, messageId: m.id, threadId: m.threadId, accountId: a.id, to: m.to, subject: m.subject, snippet: (m.bodyText ?? "").slice(0, 140), date: m.date };
    });
  }

  /** Incremental change detection via history.list; the first call stores a baseline historyId. */
  async sync(): Promise<SyncResult> {
    const a = this.account;
    const gm = this.gm;
    try {
      if (!a.historyId) {
        const p = await gm.request<{ historyId: string }>("GET", "/profile");
        await getDb().update(accounts).set({ historyId: p.historyId, lastSyncedAt: new Date() }).where(eq(accounts.id, a.id));
        return { changed: false, newInbox: 0 };
      }
      let changed = false;
      let newInbox = 0;
      let pageToken: string | undefined;
      let latest = a.historyId;
      let pages = 0;
      do {
        const h = await gm.request<{ history?: Array<{ messagesAdded?: Array<{ message: { labelIds?: string[] } }> }>; historyId: string; nextPageToken?: string }>("GET", "/history", {
          query: { startHistoryId: a.historyId, pageToken, maxResults: 200 },
        });
        latest = h.historyId;
        if (h.history?.length) changed = true;
        for (const rec of h.history ?? []) {
          for (const added of rec.messagesAdded ?? []) if (added.message.labelIds?.includes("INBOX")) newInbox++;
        }
        pageToken = h.nextPageToken;
      } while (pageToken && ++pages < 5);
      await getDb().update(accounts).set({ historyId: latest, lastSyncedAt: new Date() }).where(eq(accounts.id, a.id));
      return { changed, newInbox };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // History too old: reset the baseline and ask the client to refresh everything.
        const p = await gm.request<{ historyId: string }>("GET", "/profile");
        await getDb().update(accounts).set({ historyId: p.historyId, lastSyncedAt: new Date() }).where(eq(accounts.id, a.id));
        return { changed: true, newInbox: 0 };
      }
      throw err;
    }
  }
}
