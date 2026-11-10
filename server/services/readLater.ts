import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { readLater } from "../db/schema.js";
import { GmailClient, mapLimit } from "../gmail/client.js";
import { summarizeThread, type GmailThread } from "../gmail/parse.js";
import { HttpError, badRequest } from "../lib/errors.js";
import type { ThreadPage, ThreadSummary } from "../../shared/mail.js";
import { getOwnedAccount } from "./accounts.js";
import { assertGmailId, resolveAccounts } from "./mail.js";

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date"];
export const READ_LATER_MAX = 500;

export interface ReadLaterItem { accountId: string; threadId: string; addedAt: string }

/** Save a conversation for later. The thread must exist in the user's own account. Idempotent. */
export async function addReadLater(userId: string, accountId: string, threadId: string): Promise<ReadLaterItem> {
  const acc = await getOwnedAccount(userId, accountId);
  const tid = assertGmailId(threadId, "thread");
  await new GmailClient(acc).request("GET", `/threads/${tid}`, { query: { format: "minimal" } });
  const db = getDb();
  const existing = await db.select().from(readLater).where(and(eq(readLater.userId, userId), eq(readLater.accountId, acc.id), eq(readLater.threadId, tid))).limit(1);
  if (existing[0]) return { accountId: acc.id, threadId: tid, addedAt: existing[0].createdAt.toISOString() };
  const all = await db.select({ id: readLater.id }).from(readLater).where(eq(readLater.userId, userId)).limit(READ_LATER_MAX);
  if (all.length >= READ_LATER_MAX) throw new HttpError(400, "read_later_full", `Read later holds up to ${READ_LATER_MAX} conversations. Remove some first.`);
  const [row] = await db.insert(readLater).values({ userId, accountId: acc.id, threadId: tid })
    .onConflictDoUpdate({ target: [readLater.accountId, readLater.threadId], set: { userId } })
    .returning();
  return { accountId: acc.id, threadId: tid, addedAt: row!.createdAt.toISOString() };
}

export async function removeReadLater(userId: string, accountId: string, threadId: string): Promise<boolean> {
  const acc = await getOwnedAccount(userId, accountId);
  const tid = assertGmailId(threadId, "thread");
  const rows = await getDb().delete(readLater).where(and(eq(readLater.userId, userId), eq(readLater.accountId, acc.id), eq(readLater.threadId, tid))).returning({ id: readLater.id });
  return rows.length > 0;
}

export async function listReadLater(userId: string): Promise<ReadLaterItem[]> {
  const rows = await getDb().select().from(readLater).where(eq(readLater.userId, userId)).orderBy(desc(readLater.createdAt)).limit(READ_LATER_MAX);
  return rows.map((r) => ({ accountId: r.accountId, threadId: r.threadId, addedAt: r.createdAt.toISOString() }));
}

function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const raw = /^[A-Za-z0-9_-]{1,8}$/.test(cursor) ? Buffer.from(cursor, "base64url").toString("utf8") : "";
  const n = /^\d{1,4}$/.test(raw) ? Number(raw) : -1;
  if (n < 0 || n > READ_LATER_MAX) throw badRequest("Invalid cursor");
  return n;
}

/**
 * The "Read later" view, shaped like any other folder page: most recently saved first, summaries fetched live
 * from Gmail. Conversations that no longer exist are dropped from the list; trashed or spam ones are hidden.
 */
export async function listReadLaterThreads(userId: string, p: { account?: string; cursor?: string; limit: number }): Promise<ThreadPage> {
  const accs = await resolveAccounts(userId, p.account);
  const byId = new Map(accs.map((a) => [a.id, a]));
  if (!accs.length) return { threads: [], nextCursor: null, errors: [] };
  const offset = decodeOffset(p.cursor);
  const rows = await getDb().select().from(readLater)
    .where(and(eq(readLater.userId, userId), inArray(readLater.accountId, accs.map((a) => a.id))))
    .orderBy(desc(readLater.createdAt)).limit(p.limit + 1).offset(offset);
  const page = rows.slice(0, p.limit);
  const errors: ThreadPage["errors"] = [];
  const gone: string[] = [];
  const clients = new Map<string, GmailClient>();
  const results = await mapLimit(page, 8, async (r): Promise<ThreadSummary | null> => {
    const a = byId.get(r.accountId)!;
    let gm = clients.get(a.id);
    if (!gm) clients.set(a.id, (gm = new GmailClient(a)));
    try {
      const t = await gm.request<GmailThread>("GET", `/threads/${r.threadId}`, { query: { format: "metadata", metadataHeaders: META_HEADERS } });
      const s = summarizeThread(t, a.id, a.email);
      return s.labelIds.includes("TRASH") || s.labelIds.includes("SPAM") ? null : s;
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) gone.push(r.id);
      else if (!errors.some((e) => e.accountId === a.id)) errors.push({ accountId: a.id, code: err instanceof HttpError ? err.code : "error", message: err instanceof HttpError ? err.message : "Could not load this account." });
      return null;
    }
  });
  if (gone.length) await getDb().delete(readLater).where(and(eq(readLater.userId, userId), inArray(readLater.id, gone)));
  const next = rows.length > p.limit ? offset + p.limit - gone.length : null;
  return { threads: results.filter((t): t is ThreadSummary => t !== null), nextCursor: next === null ? null : Buffer.from(String(next)).toString("base64url"), errors };
}
