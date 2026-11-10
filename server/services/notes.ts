import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { threadNotes } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { GmailClient } from "../gmail/client.js";
import { HttpError } from "../lib/errors.js";
import { NOTE_LIMITS, type ThreadNote } from "../../shared/notes.js";
import { getOwnedAccount } from "./accounts.js";
import { assertGmailId } from "./mail.js";

const PURPOSE = "note";
// Bound to the owner and the conversation, so ciphertext can't be moved between users or threads.
const aad = (userId: string, accountId: string, threadId: string) => `${userId}:${accountId}:${threadId}`;

type Row = typeof threadNotes.$inferSelect;

function toNote(r: Row): ThreadNote {
  return {
    accountId: r.accountId,
    threadId: r.threadId,
    body: decrypt(r.bodyEnc, PURPOSE, aad(r.userId, r.accountId, r.threadId)),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function getNote(userId: string, accountId: string, threadId: string): Promise<ThreadNote | null> {
  const acc = await getOwnedAccount(userId, accountId);
  const tid = assertGmailId(threadId, "thread");
  const [row] = await getDb().select().from(threadNotes)
    .where(and(eq(threadNotes.userId, userId), eq(threadNotes.accountId, acc.id), eq(threadNotes.threadId, tid))).limit(1);
  return row ? toNote(row) : null;
}

/** Create or replace the note on a conversation. The thread must exist in the user's own account. */
export async function saveNote(userId: string, accountId: string, threadId: string, body: string): Promise<ThreadNote> {
  const acc = await getOwnedAccount(userId, accountId);
  const tid = assertGmailId(threadId, "thread");
  const db = getDb();
  const where = and(eq(threadNotes.userId, userId), eq(threadNotes.accountId, acc.id), eq(threadNotes.threadId, tid));
  const [existing] = await db.select({ id: threadNotes.id }).from(threadNotes).where(where).limit(1);
  const bodyEnc = encrypt(body, PURPOSE, aad(userId, acc.id, tid));
  if (existing) {
    const [row] = await db.update(threadNotes).set({ bodyEnc, updatedAt: new Date() }).where(where).returning();
    return toNote(row!);
  }
  await new GmailClient(acc).request("GET", `/threads/${tid}`, { query: { format: "minimal" } });
  const [n] = await db.select({ n: count() }).from(threadNotes).where(eq(threadNotes.userId, userId));
  if ((n?.n ?? 0) >= NOTE_LIMITS.maxPerUser) throw new HttpError(400, "note_limit", `You can keep up to ${NOTE_LIMITS.maxPerUser} notes. Delete some first.`);
  const [row] = await db.insert(threadNotes).values({ userId, accountId: acc.id, threadId: tid, bodyEnc }).returning();
  return toNote(row!);
}

export async function deleteNote(userId: string, accountId: string, threadId: string): Promise<boolean> {
  const acc = await getOwnedAccount(userId, accountId);
  const tid = assertGmailId(threadId, "thread");
  const rows = await getDb().delete(threadNotes)
    .where(and(eq(threadNotes.userId, userId), eq(threadNotes.accountId, acc.id), eq(threadNotes.threadId, tid))).returning({ id: threadNotes.id });
  return rows.length > 0;
}

/** All of the user's notes, newest first (privacy export). */
export async function listNotes(userId: string): Promise<ThreadNote[]> {
  const rows = await getDb().select().from(threadNotes).where(eq(threadNotes.userId, userId)).orderBy(desc(threadNotes.updatedAt)).limit(NOTE_LIMITS.maxPerUser);
  return rows.map(toNote);
}

export async function countNotes(userId: string): Promise<number> {
  const [n] = await getDb().select({ n: count() }).from(threadNotes).where(eq(threadNotes.userId, userId));
  return n?.n ?? 0;
}
