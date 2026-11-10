import { and, asc, eq, lte } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { snoozes } from "../db/schema.js";
import { GmailClient } from "../gmail/client.js";
import { badRequest } from "../lib/errors.js";
import { logger } from "../logger.js";
import { getOwnedAccount, listAccounts } from "./accounts.js";
import { assertGmailId, getThread } from "./mail.js";

export const SNOOZE_LABEL = "Snoozed";
export type SnoozeKind = "snooze" | "remind";
const MAX_AHEAD_MS = 366 * 86400_000;
const PER_SYNC = 25;

async function snoozeLabelId(gm: GmailClient): Promise<string> {
  const { labels } = await gm.request<{ labels?: Array<{ id: string; name: string; type: string }> }>("GET", "/labels");
  const hit = (labels ?? []).find((l) => l.type === "user" && l.name.toLowerCase() === SNOOZE_LABEL.toLowerCase());
  if (hit) return hit.id;
  const created = await gm.request<{ id: string }>("POST", "/labels", { body: { name: SNOOZE_LABEL, labelListVisibility: "labelShow", messageListVisibility: "hide" } });
  return created.id;
}

/**
 * snooze: leaves the Inbox now (labelled "Snoozed") and comes back, unread, at `until`.
 * remind: stays where it is; at `until`, if nobody has replied after your last message, it returns to the Inbox, unread and starred.
 */
export async function setSnooze(userId: string, p: { accountId: string; threadId: string; until: string; kind: SnoozeKind }) {
  const acc = await getOwnedAccount(userId, p.accountId);
  const threadId = assertGmailId(p.threadId, "thread");
  const due = new Date(p.until);
  if (Number.isNaN(due.getTime()) || due.getTime() < Date.now() + 30_000 || due.getTime() > Date.now() + MAX_AHEAD_MS) throw badRequest("Pick a time in the future (within a year).");
  const gm = new GmailClient(acc);
  if (p.kind === "snooze") {
    const label = await snoozeLabelId(gm);
    await gm.request("POST", `/threads/${threadId}/modify`, { body: { addLabelIds: [label], removeLabelIds: ["INBOX"] } });
  } else {
    await gm.request("GET", `/threads/${threadId}`, { query: { format: "minimal" } }); // must exist
  }
  await getDb().insert(snoozes).values({ userId, accountId: acc.id, threadId, kind: p.kind, dueAt: due })
    .onConflictDoUpdate({ target: [snoozes.accountId, snoozes.threadId], set: { kind: p.kind, dueAt: due, userId } });
  return { accountId: acc.id, threadId, kind: p.kind, dueAt: due.toISOString() };
}

/** Cancel: a snoozed thread returns to the Inbox now; a reminder is just removed. */
export async function cancelSnooze(userId: string, accountId: string, threadId: string): Promise<void> {
  const acc = await getOwnedAccount(userId, accountId);
  assertGmailId(threadId, "thread");
  const [row] = await getDb().delete(snoozes).where(and(eq(snoozes.userId, userId), eq(snoozes.accountId, acc.id), eq(snoozes.threadId, threadId))).returning();
  if (row?.kind === "snooze") {
    const gm = new GmailClient(acc);
    await gm.request("POST", `/threads/${threadId}/modify`, { body: { addLabelIds: ["INBOX"], removeLabelIds: [await snoozeLabelId(gm)] } });
  }
}

export async function listSnoozes(userId: string) {
  const rows = await getDb().select().from(snoozes).where(eq(snoozes.userId, userId)).orderBy(asc(snoozes.dueAt)).limit(500);
  return rows.map((r) => ({ accountId: r.accountId, threadId: r.threadId, kind: r.kind as SnoozeKind, dueAt: r.dueAt.toISOString() }));
}

/**
 * Cron-free return: runs on each /mail/sync poll (every ~45 s while FLUENT is open) and is idempotent.
 * Rows are claimed with DELETE … RETURNING so concurrent tabs can't double-process.
 */
export async function processDueSnoozes(userId: string, now = new Date()): Promise<{ returned: number; reminders: number }> {
  const db = getDb();
  const due = await db.select({ id: snoozes.id }).from(snoozes).where(and(eq(snoozes.userId, userId), lte(snoozes.dueAt, now))).orderBy(asc(snoozes.dueAt)).limit(PER_SYNC);
  if (!due.length) return { returned: 0, reminders: 0 };
  const accs = new Map((await listAccounts(userId)).map((a) => [a.id, a]));
  let returned = 0;
  let reminders = 0;
  for (const { id } of due) {
    const [row] = await db.delete(snoozes).where(eq(snoozes.id, id)).returning();
    if (!row) continue;
    const acc = accs.get(row.accountId);
    if (!acc || acc.status !== "active") continue;
    const gm = new GmailClient(acc);
    try {
      if (row.kind === "snooze") {
        await gm.request("POST", `/threads/${row.threadId}/modify`, { body: { addLabelIds: ["INBOX", "UNREAD"], removeLabelIds: [await snoozeLabelId(gm)] } });
        returned++;
      } else {
        const t = await getThread(userId, acc.id, row.threadId);
        const last = t.messages.filter((m) => !m.isDraft).at(-1);
        if (last?.isFromMe) {
          await gm.request("POST", `/threads/${row.threadId}/modify`, { body: { addLabelIds: ["INBOX", "UNREAD", "STARRED"], removeLabelIds: [] } });
          reminders++;
        }
      }
    } catch (err) {
      logger.warn({ code: (err as { code?: string }).code ?? "error" }, "snooze_return_failed");
    }
  }
  return { returned, reminders };
}
