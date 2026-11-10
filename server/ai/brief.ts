import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import type { BriefItem, DailyBrief } from "../../shared/brief.js";
import type { ThreadSummary } from "../../shared/mail.js";
import { getDb } from "../db/client.js";
import { dailyBriefs } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { aiConfigured } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { listThreads } from "../services/mail.js";
import { aiCall, emailBlock, sanitizeForPrompt } from "./core.js";
import { isOpenQuestion } from "./features.js";
import { isExcluded, loadPolicy, recordAudit, type AiPolicy } from "./policy.js";

const BULK = /^CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)$/;
const NO_REPLY = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|newsletters?|news|marketing|mailer-daemon)@/i;
const NEW_WINDOW_MS = 36 * 3600_000;
const LIMITS = { important: 5, awaitingReply: 5, safeToArchive: 10 } as const;

export const briefSchema = z.object({
  headline: z.string().max(400),
  items: z.array(z.object({
    ref: z.string().max(20),
    bucket: z.enum(["important", "awaiting_reply", "safe_to_archive", "skip"]),
    reason: z.string().max(200),
  })).max(40),
});

const fmt = (a: { name: string; email: string }) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email);
export const isBulk = (t: ThreadSummary) => t.labelIds.some((l) => BULK.test(l)) || NO_REPLY.test(t.from.email);

/** Hard rules the AI can't override: never suggest archiving starred/important mail or answering your own last message. */
export function allowedIn(bucket: "important" | "awaiting_reply" | "safe_to_archive", t: ThreadSummary): boolean {
  if (bucket === "safe_to_archive") return !t.starred && !t.important && t.labelIds.includes("INBOX");
  if (bucket === "awaiting_reply") return !t.lastFromMe;
  return true;
}

/** The user's local calendar day (YYYY-MM-DD) in an IANA time zone; falls back to UTC for unknown zones. */
export function localDay(tz: string | undefined, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,2}$/;

function languageName(policy: AiPolicy, lang?: string): string {
  if (policy.settings.language && policy.settings.language !== "auto") return sanitizeForPrompt(policy.settings.language, 40);
  if (lang && LANG_RE.test(lang)) {
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(lang) ?? lang;
    } catch {
      return lang;
    }
  }
  return "English";
}

function policyKey(policy: AiPolicy, language: string): string {
  return createHash("sha256").update(JSON.stringify([[...policy.excludedLabels].sort(), [...policy.excludedSenders].sort(), language, policy.settings.tone])).digest("hex").slice(0, 32);
}

/** Gmail-only triage used without AI and as the candidate pool for the AI pass. */
function triage(threads: ThreadSummary[], now: number) {
  const fresh = threads.filter((t) => now - Date.parse(t.lastDate) <= NEW_WINDOW_MS);
  const important = fresh.filter((t) => !isBulk(t) && !t.lastFromMe && (t.unread || t.important || t.starred));
  const awaitingReply = threads.filter((t) => !t.lastFromMe && !isBulk(t) && (isOpenQuestion(t, now) || ((t.important || t.starred) && t.unread)));
  // Without AI only Gmail's own bulk categories are offered (an automated "no-reply" mail can still be a booking or receipt).
  const safeToArchive = threads.filter((t) => t.labelIds.some((l) => BULK.test(l)) && allowedIn("safe_to_archive", t));
  return { important, awaitingReply, safeToArchive };
}

const item = (thread: ThreadSummary, reason: string): BriefItem => ({ thread, reason });

function dedupe(b: Pick<DailyBrief, "important" | "awaitingReply" | "safeToArchive">) {
  const seen = new Set<string>();
  const keep = (xs: BriefItem[], n: number) => xs.filter((x) => {
    const k = `${x.thread.accountId}:${x.thread.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, n);
  return { awaitingReply: keep(b.awaitingReply, LIMITS.awaitingReply), important: keep(b.important, LIMITS.important), safeToArchive: keep(b.safeToArchive, LIMITS.safeToArchive) };
}

export async function getDailyBrief(userId: string, opts: { account?: string; tz?: string; lang?: string; refresh?: boolean }): Promise<DailyBrief> {
  const now = Date.now();
  const day = localDay(opts.tz, new Date(now));
  const scope = opts.account ?? "all";

  let policy: AiPolicy | null = null;
  let aiStatus: DailyBrief["aiStatus"] = "not_configured";
  if (aiConfigured()) {
    try {
      policy = await loadPolicy(userId);
    } catch (err) {
      if (err instanceof HttpError && err.code === "ai_disabled") aiStatus = "disabled";
      else throw err;
    }
  }
  const language = policy ? languageName(policy, opts.lang) : "English";
  const key = policy ? policyKey(policy, language) : "";
  const db = getDb();

  if (policy && !opts.refresh) {
    const [row] = await db.select().from(dailyBriefs).where(and(eq(dailyBriefs.userId, userId), eq(dailyBriefs.day, day), eq(dailyBriefs.scope, scope))).limit(1);
    if (row && row.policyKey === key) {
      const cached = JSON.parse(decrypt(row.payloadEnc, "brief", `${userId}:${day}:${scope}`)) as DailyBrief;
      return { ...cached, cached: true };
    }
  }

  const page = await listThreads(userId, { account: opts.account, folder: "inbox", q: "newer_than:14d", limit: 50 });
  const base = triage(page.threads, now);
  const plain: DailyBrief = {
    day, generatedAt: new Date(now).toISOString(), cached: false, headline: null, aiStatus, excluded: 0,
    ...dedupe({
      important: base.important.map((t) => item(t, t.important ? "Marked important by Gmail" : t.starred ? "Starred" : "New and unread")),
      awaitingReply: base.awaitingReply.map((t) => item(t, "They asked you something and haven't heard back")),
      safeToArchive: base.safeToArchive.map((t) => item(t, "Promotion, social or forum update")),
    }),
  };
  if (!policy) return plain;

  // Candidate pool for the model: new mail first, then open questions and bulk mail. Exclusions are applied before any content leaves the server.
  const pool = [...new Map([...base.important, ...base.awaitingReply, ...page.threads.filter((t) => now - Date.parse(t.lastDate) <= NEW_WINDOW_MS), ...base.safeToArchive]
    .map((t) => [`${t.accountId}:${t.id}`, t] as const)).values()].slice(0, 30);
  const allowed = pool.filter((t) => !isExcluded(policy, t.accountId, t));
  const excluded = pool.length - allowed.length;
  if (allowed.length === 0) return { ...plain, aiStatus: "ok", excluded, headline: null, important: [], awaitingReply: [], safeToArchive: [] };

  const refs = new Map<string, ThreadSummary>();
  const blocks = allowed.map((t, i) => {
    const ref = `t${i + 1}`;
    refs.set(ref, t);
    const flags = [t.unread && "unread", t.important && "important", t.starred && "starred", t.lastFromMe && "last message sent by the user", isBulk(t) && "bulk/automated"].filter(Boolean).join(", ");
    return emailBlock({ ref, from: fmt(t.from), date: t.lastDate, subject: t.subject, body: t.snippet, labels: flags });
  });
  try {
    const out = await aiCall({
      task: "brief",
      system: [
        `Write the user's morning brief for ${day}. Each email shows only a short snippet.`,
        `Write the headline and every reason in ${language}, whatever language the emails are in.`,
        "headline: one or two friendly sentences on what matters today.",
        "For each email choose a bucket: important (new mail that matters today), awaiting_reply (someone is waiting for the user's answer), safe_to_archive (newsletters, promotions, automated notices with nothing to do), or skip.",
        "Never put personal mail from a real person, anything with a deadline, invoice, security alert or open question in safe_to_archive. Reasons are short (max 12 words) and concrete.",
      ].join("\n"),
      prompt: blocks.join("\n"),
      schema: briefSchema,
      maxOutputTokens: 1500,
    });
    const buckets = { important: [] as BriefItem[], awaiting_reply: [] as BriefItem[], safe_to_archive: [] as BriefItem[] };
    for (const it of out.items) {
      const t = refs.get(it.ref);
      if (!t || it.bucket === "skip" || !allowedIn(it.bucket, t)) continue;
      buckets[it.bucket].push(item(t, it.reason));
    }
    const brief: DailyBrief = {
      ...plain, aiStatus: "ok", excluded, headline: out.headline,
      ...dedupe({ important: buckets.important, awaitingReply: buckets.awaiting_reply, safeToArchive: buckets.safe_to_archive }),
    };
    await recordAudit(userId, policy, "daily_brief", allowed.map((t) => ({ accountId: t.accountId, threadId: t.id, subject: t.subject })), excluded);
    const payloadEnc = encrypt(JSON.stringify(brief), "brief", `${userId}:${day}:${scope}`);
    await db.insert(dailyBriefs).values({ userId, day, scope, policyKey: key, payloadEnc })
      .onConflictDoUpdate({ target: [dailyBriefs.userId, dailyBriefs.day, dailyBriefs.scope], set: { policyKey: key, payloadEnc, createdAt: new Date() } });
    // Only today's brief is useful; older ones are dropped.
    await db.delete(dailyBriefs).where(and(eq(dailyBriefs.userId, userId), lt(dailyBriefs.createdAt, new Date(now - 2 * 86400_000))));
    return brief;
  } catch (err) {
    if (err instanceof HttpError && err.status === 429) throw err;
    return { ...plain, aiStatus: "error", excluded };
  }
}

/** Forget cached briefs (used when the user clears their AI history). */
export async function clearBriefs(userId: string): Promise<number> {
  const rows = await getDb().delete(dailyBriefs).where(eq(dailyBriefs.userId, userId)).returning({ id: dailyBriefs.id });
  return rows.length;
}
