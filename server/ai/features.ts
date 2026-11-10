import { z } from "zod";
import type { ThreadDetail, ThreadSummary } from "../../shared/mail.js";
import { getThread, listThreads } from "../services/mail.js";
import { aiCall, emailBlock, sanitizeForPrompt, todayContext } from "./core.js";
import { isExcluded, loadPolicy, recordAudit, type AiPolicy } from "./policy.js";
import { HttpError } from "../lib/errors.js";

const fmt = (a: { name: string; email: string }) => (a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email);


async function loadThreadForAi(userId: string, policy: AiPolicy, accountId: string, threadId: string): Promise<ThreadDetail> {
  const t = await getThread(userId, accountId, threadId);
  // Exclusion is decided on sender/participants and labels before any content leaves the server.
  if (isExcluded(policy, accountId, { labelIds: t.labelIds, participants: t.messages.map((m) => m.from) })) {
    throw new HttpError(403, "ai_excluded", "This conversation is excluded from AI by your privacy settings.");
  }
  return t;
}

function threadBlocks(t: ThreadDetail): string {
  return t.messages
    .filter((m) => !m.isDraft)
    .slice(-12)
    .map((m, i) => emailBlock({
      ref: `m${i + 1}`,
      from: m.isFromMe ? `${fmt(m.from)} (the user)` : fmt(m.from),
      to: [...m.to, ...m.cc].map(fmt).join(", "),
      date: m.date,
      subject: m.subject,
      body: m.bodyText ?? "",
    }))
    .join("\n");
}

function prefs(policy: AiPolicy): string {
  const lang = policy.settings.language && policy.settings.language !== "auto" ? `Write in ${sanitizeForPrompt(policy.settings.language, 40)}.` : "Write in the language of the conversation.";
  return `The user prefers a ${policy.settings.tone} tone. ${lang}`;
}

// ---------------- Thread insights (summary, tasks, deadlines, quick replies) ----------------
export const insightsSchema = z.object({
  summary: z.string().max(1200),
  keyPoints: z.array(z.string().max(300)).max(6),
  actionItems: z.array(z.object({ task: z.string().max(300), owner: z.string().max(100).nullable(), due: z.string().max(100).nullable() })).max(8),
  deadlines: z.array(z.object({ what: z.string().max(200), when: z.string().max(100) })).max(6),
  needsReply: z.boolean(),
  quickReplies: z.array(z.string().max(60)).max(3).default([]),
});
export type Insights = z.infer<typeof insightsSchema>;

export async function threadInsights(userId: string, accountId: string, threadId: string): Promise<Insights> {
  const policy = await loadPolicy(userId);
  const t = await loadThreadForAi(userId, policy, accountId, threadId);
  const out = await aiCall({
    task: "insights",
    system: `Summarise an email conversation for the user (${t.accountEmail}). ${todayContext()} Be concise and specific: 2-3 sentences of summary, then key points, concrete action items for the user, explicit deadlines with dates, whether the user needs to reply, and up to 3 very short reply options (2-5 words each) the user could pick.`,
    prompt: `Conversation:\n${threadBlocks(t)}`,
    schema: insightsSchema,
  });
  await recordAudit(userId, policy, "thread_summary", [{ accountId, threadId, subject: t.subject }]);
  return { ...out, quickReplies: out.quickReplies ?? [] };
}

export async function explainThread(userId: string, accountId: string, threadId: string): Promise<string> {
  const policy = await loadPolicy(userId);
  const t = await loadThreadForAi(userId, policy, accountId, threadId);
  const text = await aiCall<string>({
    task: "explain",
    system: `Explain the latest email in this conversation in plain, simple language for the user. Clarify jargon, what is being asked, and any risks (e.g. phishing signs). ${prefs(policy)} Use at most 150 words.`,
    prompt: threadBlocks(t),
  });
  await recordAudit(userId, policy, "explain", [{ accountId, threadId, subject: t.subject }]);
  return text;
}

export async function answerAboutThread(userId: string, accountId: string, threadId: string, question: string): Promise<string> {
  const policy = await loadPolicy(userId);
  const t = await loadThreadForAi(userId, policy, accountId, threadId);
  const text = await aiCall<string>({
    task: "thread_question",
    system: `Answer the user's question using only this conversation. If the answer isn't there, say so. ${todayContext()} Keep it under 150 words.`,
    prompt: `${threadBlocks(t)}\nQUESTION: ${sanitizeForPrompt(question, 1000)}`,
  });
  await recordAudit(userId, policy, "copilot_thread", [{ accountId, threadId, subject: t.subject }]);
  return text;
}

// ---------------- Drafting & rewriting ----------------
export const draftSchema = z.object({ subject: z.string().max(200).nullable(), body: z.string().max(8000) });

export async function draftEmail(userId: string, p: { accountId?: string; threadId?: string; mode: "new" | "reply" | "forward"; instruction?: string }) {
  const policy = await loadPolicy(userId);
  let context = "";
  const audit: Array<{ accountId: string; threadId: string; subject: string }> = [];
  if (p.accountId && p.threadId) {
    const t = await loadThreadForAi(userId, policy, p.accountId, p.threadId);
    context = `Conversation being ${p.mode === "forward" ? "forwarded" : "replied to"}:\n${threadBlocks(t)}\n`;
    audit.push({ accountId: p.accountId, threadId: p.threadId, subject: t.subject });
  }
  const out = await aiCall({
    task: "draft",
    system: `Draft an email body for the user to review. ${prefs(policy)} Write only the body as plain text with blank lines between paragraphs; include a greeting and a short sign-off without a name or signature. Never invent facts, prices, dates or commitments the user didn't state; leave [placeholders] instead. Return subject only for new emails, otherwise null.`,
    prompt: `${context}Mode: ${p.mode}\nUser instruction (from the user, trusted): ${sanitizeForPrompt(p.instruction ?? (p.mode === "reply" ? "Write an appropriate reply." : "Write the email."), 1000)}`,
    schema: draftSchema,
  });
  await recordAudit(userId, policy, `draft_${p.mode}`, audit);
  return out;
}

export async function rewriteText(userId: string, p: { text: string; operation: "shorter" | "longer" | "fix" | "tone"; tone?: string }) {
  const policy = await loadPolicy(userId);
  const how = {
    shorter: "Make it noticeably shorter while keeping every important fact.",
    longer: "Make it more detailed and complete without inventing facts; use [placeholders] for unknowns.",
    fix: "Fix spelling, grammar and punctuation only. Keep wording and tone.",
    tone: `Rewrite it in a ${sanitizeForPrompt(p.tone ?? policy.settings.tone, 30)} tone.`,
  }[p.operation];
  const out = await aiCall({
    task: "rewrite",
    system: `Rewrite the user's own draft. ${how} Keep the same language. Return plain text with blank lines between paragraphs.`,
    prompt: `<draft>\n${sanitizeForPrompt(p.text, 8000)}\n</draft>`,
    schema: z.object({ text: z.string().max(10000) }),
  });
  await recordAudit(userId, policy, `rewrite_${p.operation}`, []);
  return out;
}

// ---------------- Natural-language search ----------------
export const searchSchema = z.object({
  gmailQuery: z.string().min(1).max(300),
  explanation: z.string().max(300),
  postFilter: z.enum(["none", "unanswered"]),
});

const FORBIDDEN_QUERY = /[\r\n]/;

export async function interpretSearch(userId: string, query: string) {
  const policy = await loadPolicy(userId);
  const out = await aiCall({
    task: "search",
    system: [
      "Translate the user's request into a Gmail search query (Gmail search operators only: from:, to:, cc:, subject:, label:, category:, has:attachment, filename:, is:unread, is:starred, is:important, in:inbox, in:sent, in:anywhere, after:YYYY/MM/DD, before:YYYY/MM/DD, newer_than:Nd, older_than:Nd, OR, -, quotes, parentheses).",
      todayContext(),
      "Prefer broad keyword matches over guessing exact addresses (e.g. 'school' instead of from:school@...). Use postFilter=\"unanswered\" when the user wants conversations they haven't replied to (and add -from:me plus a time window). Give a one-sentence plain-language explanation.",
    ].join("\n"),
    prompt: `User request: ${sanitizeForPrompt(query, 500)}`,
    schema: searchSchema,
    maxOutputTokens: 300,
  });
  if (FORBIDDEN_QUERY.test(out.gmailQuery)) throw new HttpError(502, "ai_unavailable", "The AI returned an invalid search.");
  await recordAudit(userId, policy, "nl_search", []);
  return out;
}

// ---------------- Ask your inbox (retrieval-grounded Q&A) ----------------
export const askSchema = z.object({ answer: z.string().max(2000), citations: z.array(z.string().max(100)).max(12) });

export async function askInbox(userId: string, p: { question: string; account?: string }) {
  const policy = await loadPolicy(userId);
  const search = await interpretSearch(userId, p.question);
  let page = await listThreads(userId, { account: p.account, folder: "all", q: search.gmailQuery, limit: 10, filter: search.postFilter === "unanswered" ? "unanswered" : undefined });
  if (page.threads.length === 0) {
    // Fall back to recent mail so general questions ("what's new?") still have grounding.
    page = await listThreads(userId, { account: p.account, folder: "inbox", limit: 10 });
  }
  const allowed = page.threads.filter((t) => !isExcluded(policy, t.accountId, t));
  const excluded = page.threads.length - allowed.length;
  const top = allowed.slice(0, 6);
  const details = await Promise.all(top.map((t) => getThread(userId, t.accountId, t.id).catch(() => null)));
  const refs = new Map<string, ThreadSummary>();
  const blocks = top.map((t, i) => {
    const ref = `t${i + 1}`;
    refs.set(ref, t);
    const d = details[i];
    const body = d ? d.messages.filter((m) => !m.isDraft).slice(-4).map((m) => `From ${fmt(m.from)} on ${m.date}:\n${m.bodyText ?? ""}`).join("\n---\n") : t.snippet;
    return emailBlock({ ref, from: fmt(t.from), date: t.lastDate, subject: t.subject, body });
  });
  const out = await aiCall({
    task: "ask",
    system: `Answer the user's question about their email using ONLY the emails provided. ${todayContext()} Cite the refs (e.g. t1) of the emails you used in "citations". If the emails don't contain the answer, say so plainly. Keep it under 180 words.`,
    prompt: `${blocks.join("\n") || "(no matching emails)"}\nQUESTION: ${sanitizeForPrompt(p.question, 1000)}`,
    schema: askSchema,
  });
  await recordAudit(userId, policy, "ask_inbox", top.map((t) => ({ accountId: t.accountId, threadId: t.id, subject: t.subject })), excluded);
  // Grounding: only citations that map to emails we actually supplied are returned.
  const citations = [...new Set(out.citations)].map((r) => refs.get(r)).filter((t): t is ThreadSummary => Boolean(t));
  return { answer: out.answer, citations, gmailQuery: search.gmailQuery, searched: top.length, excluded };
}

// ---------------- AI Overview ----------------
export const overviewSchema = z.object({
  headline: z.string().max(400),
  items: z.array(z.object({
    ref: z.string().max(20),
    category: z.enum(["needs_reply", "important", "waiting", "deadline", "unresolved", "fyi"]),
    reason: z.string().max(300),
    due: z.string().max(100).nullable(),
  })).max(15),
});

export interface OverviewResult {
  generatedAt: string;
  stats: { unread: number; needsReply: number; waiting: number; important: number; total: number };
  needsReply: ThreadSummary[];
  waiting: ThreadSummary[];
  /** Received questions you haven't answered (Gmail signals only: last message from them and it asks something). */
  questions: ThreadSummary[];
  important: ThreadSummary[];
  ai: { headline: string; items: Array<{ thread: ThreadSummary; category: string; reason: string; due: string | null }> } | null;
  aiStatus: "ok" | "not_configured" | "disabled" | "error";
  aiMessage?: string;
  excluded: number;
}

/** Deterministic triage from Gmail metadata (works without AI), optionally ranked/explained by AI. */
const BULK_CATEGORIES = /^CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)$/;
const NO_REPLY = /(^|[._-])(no-?reply|do-?not-?reply|notifications?|mailer-daemon)@/i;

/** Follow-up radar: an inbox thread whose last message is from someone else and asks a question. */
export function isOpenQuestion(t: ThreadSummary, now = Date.now()): boolean {
  if (t.lastFromMe || t.labelIds.some((l) => BULK_CATEGORIES.test(l)) || NO_REPLY.test(t.from.email)) return false;
  if (now - Date.parse(t.lastDate) > 14 * 86400_000) return false;
  return /\?/.test(`${t.subject} ${t.snippet}`) || /\b(can|could|would|will) you\b|\bplease (confirm|let me know|reply|advise)\b|\blet me know\b/i.test(t.snippet);
}

export async function buildOverview(userId: string, account: string | undefined, useAi: () => Promise<AiPolicy | null>): Promise<OverviewResult> {
  const [inbox, sent] = await Promise.all([
    listThreads(userId, { account, folder: "inbox", q: "newer_than:14d", limit: 40 }),
    listThreads(userId, { account, folder: "sent", q: "newer_than:21d", limit: 25 }),
  ]);
  const now = Date.now();
  const inboxT = inbox.threads;
  const needsReply = inboxT.filter((t) => !t.lastFromMe && (t.unread || t.important || t.starred) && !t.labelIds.some((l) => /^CATEGORY_(PROMOTIONS|SOCIAL|FORUMS)$/.test(l)));
  const waiting = sent.threads.filter((t) => t.lastFromMe && now - Date.parse(t.lastDate) > 2 * 86400_000);
  const important = inboxT.filter((t) => t.important || t.starred);
  const questions = inboxT.filter((t) => isOpenQuestion(t, now));
  const base: OverviewResult = {
    generatedAt: new Date().toISOString(),
    stats: { unread: inboxT.filter((t) => t.unread).length, needsReply: needsReply.length, waiting: waiting.length, important: important.length, total: inboxT.length },
    needsReply: needsReply.slice(0, 10),
    waiting: waiting.slice(0, 10),
    questions: questions.slice(0, 10),
    important: important.slice(0, 10),
    ai: null,
    aiStatus: "not_configured",
    excluded: 0,
  };
  let policy: AiPolicy | null;
  try {
    policy = await useAi();
  } catch (err) {
    if (err instanceof HttpError && err.code === "ai_disabled") return { ...base, aiStatus: "disabled" };
    if (err instanceof HttpError && err.code === "not_configured") return base;
    throw err;
  }
  if (!policy) return base;
  const candidates = [...inboxT.slice(0, 25), ...waiting.slice(0, 8)];
  const allowed = candidates.filter((t) => !isExcluded(policy, t.accountId, t));
  const refs = new Map<string, ThreadSummary>();
  const blocks = allowed.map((t, i) => {
    const ref = `t${i + 1}`;
    refs.set(ref, t);
    const flags = [t.unread && "unread", t.important && "important", t.starred && "starred", t.lastFromMe && "last message sent by the user"].filter(Boolean).join(", ");
    return emailBlock({ ref, from: fmt(t.from), date: t.lastDate, subject: t.subject, body: t.snippet, labels: flags });
  });
  try {
    const out = await aiCall({
      task: "overview",
      system: `Produce an inbox briefing for the user. ${todayContext()} Each email shows only a short snippet. Write a one-sentence headline of what happened. Then list the conversations that matter, each with a category (needs_reply, important, waiting = user is waiting on someone, deadline, unresolved, fyi), a short concrete reason, and a due date if one is mentioned. Skip newsletters and promotions unless they contain a deadline. Most urgent first.`,
      prompt: blocks.join("\n"),
      schema: overviewSchema,
      maxOutputTokens: 1800,
    });
    await recordAudit(userId, policy, "overview", allowed.map((t) => ({ accountId: t.accountId, threadId: t.id, subject: t.subject })), candidates.length - allowed.length);
    const items = out.items
      .map((it) => ({ thread: refs.get(it.ref), category: it.category, reason: it.reason, due: it.due }))
      .filter((it): it is { thread: ThreadSummary; category: typeof it.category; reason: string; due: string | null } => Boolean(it.thread));
    return { ...base, ai: { headline: out.headline, items }, aiStatus: "ok", excluded: candidates.length - allowed.length };
  } catch (err) {
    return { ...base, aiStatus: "error", aiMessage: err instanceof HttpError ? err.message : "AI unavailable", excluded: candidates.length - allowed.length };
  }
}

export { loadPolicy };
