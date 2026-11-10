import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { aiAudit, userSettings } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { parseSettings, type Settings } from "../../shared/settings.js";
import { aiConfigured } from "../env.js";
import { HttpError, notConfigured } from "../lib/errors.js";
import type { Address } from "../../shared/mail.js";

export interface AiPolicy {
  settings: Settings["ai"];
  keepDays: number;
  excludedLabels: Set<string>; // "<accountId>:<labelId>"
  excludedSenders: string[]; // emails or "@domain" / "domain"
}

export async function loadPolicy(userId: string): Promise<AiPolicy> {
  if (!aiConfigured()) throw notConfigured("AI");
  const rows = await getDb().select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const s = parseSettings(rows[0]?.data);
  if (!s.ai.enabled) throw new HttpError(403, "ai_disabled", "AI features are turned off in your settings.");
  return {
    settings: s.ai,
    keepDays: s.privacy.keepAiHistoryDays,
    excludedLabels: new Set(s.ai.excludedLabels),
    excludedSenders: s.ai.excludedSenders.map((x) => x.trim().toLowerCase()).filter(Boolean),
  };
}

export function senderExcluded(policy: AiPolicy, email: string): boolean {
  const e = email.toLowerCase();
  const domain = e.split("@")[1] ?? "";
  return policy.excludedSenders.some((rule) => {
    if (rule.includes("@") && !rule.startsWith("@")) return rule === e;
    const d = rule.replace(/^@/, "");
    return domain === d || domain.endsWith(`.${d}`);
  });
}

/** Server-side exclusion check, applied before any email content reaches the AI provider. */
export function isExcluded(policy: AiPolicy, accountId: string, thread: { labelIds: string[]; participants: Address[] }): boolean {
  if (thread.labelIds.some((l) => policy.excludedLabels.has(`${accountId}:${l}`))) return true;
  return thread.participants.some((p) => senderExcluded(policy, p.email));
}

export interface AuditItem {
  accountId: string | null;
  threadId: string;
  subject: string;
}

/** Record what the AI accessed: ids and (encrypted) subjects only — never bodies or prompts. */
export async function recordAudit(userId: string, policy: AiPolicy, feature: string, items: AuditItem[], excludedCount = 0): Promise<void> {
  if (policy.keepDays === 0) return;
  const db = getDb();
  const accountIds = [...new Set(items.map((i) => i.accountId).filter(Boolean))];
  await db.insert(aiAudit).values({
    userId,
    accountId: accountIds.length === 1 ? accountIds[0] : null,
    feature,
    threadIds: items.map((i) => (i.accountId ? `${i.accountId}:${i.threadId}` : i.threadId)),
    subjectsEnc: items.length ? encrypt(JSON.stringify(items.map((i) => i.subject.slice(0, 200))), "audit", userId) : null,
    itemCount: items.length,
    excludedCount,
  });
  await purgeAudit(userId, policy.keepDays);
}

/** Enforce the user's AI-history retention window (called on writes, reads and session loads). */
export async function purgeAudit(userId: string, keepDays: number): Promise<void> {
  if (keepDays <= 0) return;
  await getDb().delete(aiAudit).where(and(eq(aiAudit.userId, userId), lt(aiAudit.createdAt, sql`now() - make_interval(days => ${keepDays})`)));
}

export interface AuditEntry {
  id: string;
  feature: string;
  createdAt: string;
  items: Array<{ accountId: string | null; threadId: string; subject: string }>;
  itemCount: number;
  excludedCount: number;
}

export async function listAudit(userId: string, limit = 100): Promise<AuditEntry[]> {
  const rows = await getDb().select().from(aiAudit).where(eq(aiAudit.userId, userId)).orderBy(desc(aiAudit.createdAt)).limit(limit);
  return rows.map((r) => {
    let subjects: string[] = [];
    try {
      subjects = r.subjectsEnc ? (JSON.parse(decrypt(r.subjectsEnc, "audit", userId)) as string[]) : [];
    } catch {
      subjects = [];
    }
    return {
      id: r.id,
      feature: r.feature,
      createdAt: r.createdAt.toISOString(),
      itemCount: r.itemCount,
      excludedCount: r.excludedCount,
      items: r.threadIds.map((t, i) => {
        const [a, th] = t.includes(":") ? t.split(":") : [null, t];
        return { accountId: a ?? null, threadId: th ?? t, subject: subjects[i] ?? "" };
      }),
    };
  });
}

export async function clearAudit(userId: string): Promise<number> {
  const r = await getDb().delete(aiAudit).where(eq(aiAudit.userId, userId)).returning({ id: aiAudit.id });
  return r.length;
}
