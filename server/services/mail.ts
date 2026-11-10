import { GmailClient } from "../gmail/client.js";
import type { Category, DraftSummary, Folder, ThreadAction, ThreadDetail, ThreadPage, ThreadSummary } from "../../shared/mail.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { getOwnedAccount, listAccounts, type AccountRow } from "./accounts.js";
import { capabilitiesOf, gmailOnlyError, providerFor } from "../providers/index.js";
import { assertMailId, folderQuery, MAIL_ID } from "../providers/gmail.js";

// Mail ids are opaque, URL-safe strings for every provider (Gmail ids; other providers encode theirs the same way).
export const GMAIL_ID = MAIL_ID;
export const assertGmailId = assertMailId;
export { folderQuery };

/** A Gmail REST client for Gmail-only features (labels, filters); other providers get a clear 400. */
function gmailClient(a: AccountRow): GmailClient {
  if (!capabilitiesOf(a).filters) throw gmailOnlyError();
  return new GmailClient(a);
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
  if (p.folder === "later") throw badRequest("Read later is not a Gmail folder");
  const folder = p.folder;
  if (p.label) assertMailId(p.label, "label");
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
      const caps = capabilitiesOf(a);
      // Gmail-only views (categories, Gmail labels) simply have nothing to show on other providers.
      if ((p.category && !caps.categories) || (p.label && !caps.labels)) {
        nextCursor[a.id] = null;
        return [];
      }
      const r = await providerFor(a).listThreads({ folder, category: p.category, label: p.label, q: p.q, pageToken: pageToken ?? undefined, limit: perAccount });
      nextCursor[a.id] = r.nextPageToken;
      return r.threads;
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
  return providerFor(await getOwnedAccount(userId, accountId)).getThread(threadId);
}

export async function threadAction(userId: string, accountId: string, threadId: string, action: ThreadAction): Promise<void> {
  await providerFor(await getOwnedAccount(userId, accountId)).threadAction(threadId, action);
}

export const BULK_MAX = 100;
export const BULK_ACTIONS = ["archive", "inbox", "trash", "untrash", "read", "unread", "star", "unstar", "label_add", "label_remove"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
const BULK_INVERSE: Record<BulkAction, BulkAction> = {
  archive: "inbox", inbox: "archive", trash: "untrash", untrash: "trash", read: "unread", unread: "read",
  star: "unstar", unstar: "star", label_add: "label_remove", label_remove: "label_add",
};

/**
 * Bulk thread actions. Label changes use one users.messages.batchModify per account (all message ids of the
 * selected threads); Trash uses threads.trash (Gmail has no batch trash). Every account is ownership-checked.
 */
export async function bulkAction(userId: string, p: { items: Array<{ accountId: string; threadId: string }>; action: BulkAction; labelId?: string }): Promise<{ ok: number; failed: number; undo: { action: BulkAction; labelId?: string } }> {
  if (!p.items.length || p.items.length > BULK_MAX) throw badRequest(`Select between 1 and ${BULK_MAX} conversations.`);
  const byAcc = new Map<string, string[]>();
  for (const it of p.items) {
    const ids = byAcc.get(it.accountId) ?? [];
    ids.push(assertGmailId(it.threadId, "thread"));
    byAcc.set(it.accountId, [...new Set(ids)]);
  }
  if ((p.action === "label_add" || p.action === "label_remove") && !p.labelId) throw badRequest("Pick a label.");
  const labelId = p.labelId ? assertGmailId(p.labelId, "label") : undefined;
  let ok = 0;
  let failed = 0;
  for (const [accountId, threadIds] of byAcc) {
    const provider = providerFor(await getOwnedAccount(userId, accountId));
    const r = await provider.bulk(threadIds, labelId ? { kind: "label", labelId, add: p.action === "label_add" } : { kind: "action", action: p.action as ThreadAction });
    ok += r.ok;
    failed += r.failed;
  }
  return { ok, failed, undo: { action: BULK_INVERSE[p.action], ...(labelId ? { labelId } : {}) } };
}

export async function modifyLabels(userId: string, accountId: string, threadId: string, add: string[], remove: string[]): Promise<void> {
  await providerFor(await getOwnedAccount(userId, accountId)).modifyLabels(threadId, add, remove);
}

export async function getLabels(userId: string, accountParam?: string) {
  const accs = await resolveAccounts(userId, accountParam);
  return {
    accounts: await Promise.all(accs.map(async (a) => {
      try {
        const { labels, counts } = await providerFor(a).labels();
        return { accountId: a.id, labels, counts, error: null as string | null };
      } catch (err) {
        return { accountId: a.id, labels: [], counts: {}, error: err instanceof HttpError ? err.code : "error" };
      }
    })),
  };
}

export async function createLabel(userId: string, accountId: string, name: string) {
  const gm = gmailClient(await getOwnedAccount(userId, accountId));
  return gm.request<{ id: string; name: string }>("POST", "/labels", { body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
}

export async function renameLabel(userId: string, accountId: string, labelId: string, name: string) {
  const gm = gmailClient(await getOwnedAccount(userId, accountId));
  return gm.request<{ id: string; name: string }>("PATCH", `/labels/${assertGmailId(labelId, "label")}`, { body: { name } });
}

export async function deleteLabel(userId: string, accountId: string, labelId: string) {
  const gm = gmailClient(await getOwnedAccount(userId, accountId));
  await gm.request("DELETE", `/labels/${assertGmailId(labelId, "label")}`);
}

export interface FilterSpec {
  criteria: { from?: string; to?: string; subject?: string; query?: string; hasAttachment?: boolean };
  action: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

export async function listFilters(userId: string, accountId: string) {
  const gm = gmailClient(await getOwnedAccount(userId, accountId));
  const r = await gm.request<{ filter?: Array<{ id: string } & FilterSpec> }>("GET", "/settings/filters");
  return r.filter ?? [];
}

export async function createFilter(userId: string, accountId: string, spec: FilterSpec) {
  const gm = gmailClient(await getOwnedAccount(userId, accountId));
  return gm.request<{ id: string } & FilterSpec>("POST", "/settings/filters", { body: spec });
}

export async function deleteFilter(userId: string, accountId: string, filterId: string) {
  const gm = gmailClient(await getOwnedAccount(userId, accountId));
  await gm.request("DELETE", `/settings/filters/${assertGmailId(filterId, "filter")}`);
}

export async function getAttachment(userId: string, accountId: string, messageId: string, attachmentId: string): Promise<Buffer> {
  return providerFor(await getOwnedAccount(userId, accountId)).getAttachment(messageId, attachmentId);
}

/** Incremental change detection per account (Gmail: history.list). */
export async function syncChanges(userId: string): Promise<{ changed: boolean; newInbox: number; accounts: Array<{ accountId: string; changed: boolean; newInbox: number; error?: string }> }> {
  const accs = (await listAccounts(userId)).filter((a) => a.status === "active");
  const results = await Promise.all(accs.map(async (a) => {
    try {
      return { accountId: a.id, ...(await providerFor(a).sync()) };
    } catch (err) {
      return { accountId: a.id, changed: false, newInbox: 0, error: err instanceof HttpError ? err.code : "error" };
    }
  }));
  return { changed: results.some((r) => r.changed), newInbox: results.reduce((s, r) => s + r.newInbox, 0), accounts: results };
}

export async function listDrafts(userId: string, accountParam?: string): Promise<DraftSummary[]> {
  const accs = await resolveAccounts(userId, accountParam);
  const all = await Promise.all(accs.map((a) => providerFor(a).listDrafts().catch(() => [] as DraftSummary[])));
  return all.flat().sort((x, y) => y.date.localeCompare(x.date));
}
