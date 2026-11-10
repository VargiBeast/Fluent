import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { GmailClient, mapLimit } from "../gmail/client.js";
import { decodeB64Url, parseMessage, summarizeThread, type GmailMessage, type GmailThread } from "../gmail/parse.js";
import type { Category, DraftSummary, Folder, GmailLabel, ThreadAction, ThreadDetail, ThreadPage, ThreadSummary } from "../../shared/mail.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { getOwnedAccount, listAccounts, type AccountRow } from "./accounts.js";

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date"];
export const GMAIL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function assertGmailId(id: string, what = "id"): string {
  if (!GMAIL_ID.test(id)) throw badRequest(`Invalid ${what}`);
  return id;
}

const CATEGORY_LABEL: Record<Category, string> = {
  primary: "CATEGORY_PERSONAL",
  promotions: "CATEGORY_PROMOTIONS",
  social: "CATEGORY_SOCIAL",
  updates: "CATEGORY_UPDATES",
  forums: "CATEGORY_FORUMS",
};

export function folderQuery(folder: Folder, category?: Category, labelId?: string): { labelIds: string[]; q: string; includeSpamTrash: boolean } {
  if (labelId) return { labelIds: [assertGmailId(labelId, "label")], q: "", includeSpamTrash: false };
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

function encodeCursor(c: Record<string, string | null>): string | null {
  return Object.values(c).some((v) => v !== null) ? Buffer.from(JSON.stringify(c)).toString("base64url") : null;
}

function decodeCursor(raw: string | undefined): Record<string, string | null> | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (v && typeof v === "object") return v as Record<string, string | null>;
  } catch { /* fallthrough */ }
  throw badRequest("Invalid cursor");
}

export async function resolveAccounts(userId: string, accountParam: string | undefined): Promise<AccountRow[]> {
  if (!accountParam || accountParam === "all") {
    const all = await listAccounts(userId);
    return all;
  }
  return [await getOwnedAccount(userId, accountParam)];
}

export interface ListParams {
  account?: string;
  folder: Folder;
  category?: Category;
  label?: string;
  q?: string;
  cursor?: string;
  limit: number;
  filter?: "unanswered";
}

export async function listThreads(userId: string, p: ListParams): Promise<ThreadPage> {
  const accs = await resolveAccounts(userId, p.account);
  const cursor = decodeCursor(p.cursor);
  const fq = folderQuery(p.folder, p.category, p.label);
  const q = [fq.q, p.q?.trim()].filter(Boolean).join(" ");
  const perAccount = accs.length > 1 ? Math.max(10, Math.ceil(p.limit / accs.length) + 5) : p.limit;
  const nextCursor: Record<string, string | null> = {};
  const errors: ThreadPage["errors"] = [];
  const results = await Promise.all(accs.map(async (a) => {
    if (cursor && !(a.id in cursor)) return [];
    const pageToken = cursor?.[a.id];
    if (cursor && pageToken === null) {
      nextCursor[a.id] = null;
      return [];
    }
    try {
      const gm = new GmailClient(a);
      const list = await gm.request<{ threads?: Array<{ id: string }>; nextPageToken?: string }>("GET", "/threads", {
        query: { labelIds: fq.labelIds, q: q || undefined, maxResults: perAccount, pageToken: pageToken ?? undefined, includeSpamTrash: fq.includeSpamTrash || undefined },
      });
      nextCursor[a.id] = list.nextPageToken ?? null;
      const threads = await mapLimit(list.threads ?? [], 8, (t) =>
        gm.request<GmailThread>("GET", `/threads/${t.id}`, { query: { format: "metadata", metadataHeaders: META_HEADERS } }).catch(() => null),
      );
      return threads.filter((t): t is GmailThread => t !== null).map((t) => summarizeThread(t, a.id, a.email));
    } catch (err) {
      nextCursor[a.id] = null;
      errors.push({ accountId: a.id, code: err instanceof HttpError ? err.code : "error", message: err instanceof HttpError ? err.message : "Could not load this account." });
      return [];
    }
  }));
  let threads: ThreadSummary[] = results.flat().sort((x, y) => y.lastDate.localeCompare(x.lastDate));
  if (p.filter === "unanswered") threads = threads.filter((t) => !t.lastFromMe);
  if (errors.length === accs.length && accs.length > 0 && threads.length === 0 && errors[0]) {
    const e = errors[0];
    throw new HttpError(e.code === "account_reauth" ? 401 : e.code === "insufficient_scopes" ? 403 : 502, e.code, e.message);
  }
  return { threads, nextCursor: encodeCursor(nextCursor), errors };
}

export async function getThread(userId: string, accountId: string, threadId: string): Promise<ThreadDetail> {
  const a = await getOwnedAccount(userId, accountId);
  const t = await new GmailClient(a).request<GmailThread>("GET", `/threads/${assertGmailId(threadId)}`, { query: { format: "full" } });
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

export async function threadAction(userId: string, accountId: string, threadId: string, action: ThreadAction): Promise<void> {
  const a = await getOwnedAccount(userId, accountId);
  const gm = new GmailClient(a);
  const id = assertGmailId(threadId);
  const spec = ACTIONS[action];
  if (spec.trash) return void (await gm.request("POST", `/threads/${id}/trash`));
  if (spec.untrash) return void (await gm.request("POST", `/threads/${id}/untrash`));
  await gm.request("POST", `/threads/${id}/modify`, { body: { addLabelIds: spec.add ?? [], removeLabelIds: spec.remove ?? [] } });
}

const SYSTEM_MUTABLE = new Set(["STARRED", "UNREAD", "IMPORTANT", "INBOX"]);

export async function modifyLabels(userId: string, accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  const a = await getOwnedAccount(userId, accountId);
  const gm = new GmailClient(a);
  const { labels } = await gm.request<{ labels?: Array<{ id: string; type: string }> }>("GET", "/labels");
  const userLabels = new Set((labels ?? []).filter((l) => l.type === "user").map((l) => l.id));
  for (const l of [...add, ...remove]) {
    if (!userLabels.has(l) && !SYSTEM_MUTABLE.has(l)) throw badRequest("Unknown label");
  }
  await gm.request("POST", `/threads/${assertGmailId(threadId)}/modify`, { body: { addLabelIds: add, removeLabelIds: remove } });
}

export async function getLabels(userId: string, accountParam?: string) {
  const accs = await resolveAccounts(userId, accountParam);
  return {
    accounts: await Promise.all(accs.map(async (a) => {
      try {
        const gm = new GmailClient(a);
        const { labels } = await gm.request<{ labels?: Array<{ id: string; name: string; type: string; color?: GmailLabel["color"] }> }>("GET", "/labels");
        const counted = await mapLimit(["INBOX", "DRAFT", "SPAM", "STARRED", "IMPORTANT"], 5, (id) =>
          gm.request<{ id: string; threadsUnread?: number; threadsTotal?: number }>("GET", `/labels/${id}`).catch(() => null),
        );
        const counts: Record<string, number> = {};
        for (const c of counted) {
          if (!c) continue;
          counts[c.id] = c.id === "DRAFT" ? (c.threadsTotal ?? 0) : (c.threadsUnread ?? 0);
        }
        return {
          accountId: a.id,
          labels: (labels ?? [])
            .filter((l) => l.type === "user")
            .map((l) => ({ id: l.id, name: l.name, type: "user" as const, color: l.color ?? null }))
            .sort((x, y) => x.name.localeCompare(y.name)),
          counts,
          error: null as string | null,
        };
      } catch (err) {
        return { accountId: a.id, labels: [], counts: {}, error: err instanceof HttpError ? err.code : "error" };
      }
    })),
  };
}

export async function createLabel(userId: string, accountId: string, name: string) {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  return gm.request<{ id: string; name: string }>("POST", "/labels", { body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
}

export async function renameLabel(userId: string, accountId: string, labelId: string, name: string) {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  return gm.request<{ id: string; name: string }>("PATCH", `/labels/${assertGmailId(labelId, "label")}`, { body: { name } });
}

export async function deleteLabel(userId: string, accountId: string, labelId: string) {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  await gm.request("DELETE", `/labels/${assertGmailId(labelId, "label")}`);
}

export interface FilterSpec {
  criteria: { from?: string; to?: string; subject?: string; query?: string; hasAttachment?: boolean };
  action: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

export async function listFilters(userId: string, accountId: string) {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  const r = await gm.request<{ filter?: Array<{ id: string } & FilterSpec> }>("GET", "/settings/filters");
  return r.filter ?? [];
}

export async function createFilter(userId: string, accountId: string, spec: FilterSpec) {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  return gm.request<{ id: string } & FilterSpec>("POST", "/settings/filters", { body: spec });
}

export async function deleteFilter(userId: string, accountId: string, filterId: string) {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  await gm.request("DELETE", `/settings/filters/${assertGmailId(filterId, "filter")}`);
}

export async function getAttachment(userId: string, accountId: string, messageId: string, attachmentId: string): Promise<Buffer> {
  const gm = new GmailClient(await getOwnedAccount(userId, accountId));
  const r = await gm.request<{ data?: string }>("GET", `/messages/${assertGmailId(messageId)}/attachments/${assertGmailId(attachmentId.slice(0, 128), "attachment")}`);
  return decodeB64Url(r.data ?? "");
}

/** Incremental change detection via history.list; first call stores a baseline historyId. */
export async function syncChanges(userId: string): Promise<{ changed: boolean; newInbox: number; accounts: Array<{ accountId: string; changed: boolean; newInbox: number; error?: string }> }> {
  const accs = (await listAccounts(userId)).filter((a) => a.status === "active");
  const results = await Promise.all(accs.map(async (a) => {
    const gm = new GmailClient(a);
    try {
      if (!a.historyId) {
        const p = await gm.request<{ historyId: string }>("GET", "/profile");
        await getDb().update(accounts).set({ historyId: p.historyId }).where(eq(accounts.id, a.id));
        return { accountId: a.id, changed: false, newInbox: 0 };
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
      if (latest !== a.historyId) await getDb().update(accounts).set({ historyId: latest }).where(eq(accounts.id, a.id));
      return { accountId: a.id, changed, newInbox };
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // History too old: reset baseline and ask the client to refresh everything.
        const p = await gm.request<{ historyId: string }>("GET", "/profile");
        await getDb().update(accounts).set({ historyId: p.historyId }).where(eq(accounts.id, a.id));
        return { accountId: a.id, changed: true, newInbox: 0 };
      }
      return { accountId: a.id, changed: false, newInbox: 0, error: err instanceof HttpError ? err.code : "error" };
    }
  }));
  return { changed: results.some((r) => r.changed), newInbox: results.reduce((s, r) => s + r.newInbox, 0), accounts: results };
}

export async function listDrafts(userId: string, accountParam?: string): Promise<DraftSummary[]> {
  const accs = await resolveAccounts(userId, accountParam);
  const all = await Promise.all(accs.map(async (a) => {
    const gm = new GmailClient(a);
    try {
      const r = await gm.request<{ drafts?: Array<{ id: string; message: { id: string; threadId: string } }> }>("GET", "/drafts", { query: { maxResults: 50 } });
      const full = await mapLimit(r.drafts ?? [], 8, (d) => gm.request<{ id: string; message: GmailMessage }>("GET", `/drafts/${d.id}`, { query: { format: "full" } }).catch(() => null));
      return full.filter((d): d is { id: string; message: GmailMessage } => d !== null).map((d) => {
        const m = parseMessage(d.message, a.email);
        return { draftId: d.id, messageId: m.id, threadId: m.threadId, accountId: a.id, to: m.to, subject: m.subject, snippet: (m.bodyText ?? "").slice(0, 140), date: m.date };
      });
    } catch {
      return [];
    }
  }));
  return all.flat().sort((x, y) => y.date.localeCompare(x.date));
}
