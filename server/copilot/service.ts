import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { copilotPlans } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { GmailClient, mapLimit } from "../gmail/client.js";
import { buildMime, toBase64Url } from "../gmail/mime.js";
import { senderFrom } from "../services/sendas.js";
import { aiCall, sanitizeForPrompt, todayContext } from "../ai/core.js";
import { answerAboutThread, askInbox, draftEmail } from "../ai/features.js";
import { isExcluded, loadPolicy, recordAudit, type AiPolicy } from "../ai/policy.js";
import { getThread, listThreads } from "../services/mail.js";
import { getOwnedAccount, listAccounts, type AccountRow } from "../services/accounts.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { logger } from "../logger.js";
import type { Address, ThreadDetail, ThreadSummary } from "../../shared/mail.js";
import {
  COPILOT_LIMITS, SEND_ACTIONS, type ActionResult, type CopilotActionType, type CopilotReply, type ExecuteRequest,
  type ExecuteResult, type PlanAction, type PlanDraft, type PlanPreview, type PlanThread,
} from "../../shared/copilot.js";
import { plannerSchema, plannerSystemPrompt, validatePlan, type ValidAction } from "./plan.js";

// ---------------------------------------------------------------------------------------------
// Stored (encrypted) plan format
// ---------------------------------------------------------------------------------------------

interface StoredDraft extends PlanDraft {
  inReplyTo: string | null;
  references: string | null;
}

interface StoredAction {
  index: number;
  type: CopilotActionType;
  title: string;
  label: string | null;
  /** Per account: existing label id, or null when the label must be created on confirm. */
  labelIds: Record<string, string | null>;
  threads: PlanThread[];
  drafts: StoredDraft[];
  executable: boolean;
}

interface StoredPlan {
  v: 1;
  actions: StoredAction[];
}

interface UndoOp {
  accountId: string;
  threadId: string;
  subject: string;
  add: string[];
  remove: string[];
  untrash?: boolean;
}

interface StoredUndo {
  v: 1;
  ops: UndoOp[];
}

const shortName = (a: Address) => a.name || a.email;
const key = (accountId: string, threadId: string) => `${accountId}:${threadId}`;

// ---------------------------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------------------------

export interface PlanRequest {
  instruction: string;
  context?: { accountId: string; threadId: string };
  account?: string;
}

export async function createPlan(userId: string, sessionId: string, req: PlanRequest): Promise<CopilotReply> {
  const policy = await loadPolicy(userId);
  const all = (await listAccounts(userId)).filter((a) => a.status === "active");
  const accs = req.context
    ? [await getOwnedAccount(userId, req.context.accountId)]
    : req.account && req.account !== "all" ? [await getOwnedAccount(userId, req.account)] : all;
  if (accs.length === 0) throw new HttpError(400, "no_accounts", "Connect a Gmail account first.");
  const labelMaps = await loadLabelMaps(accs);
  const labelNames = [...new Set(labelMaps.flatMap((m) => [...m.byName.values()].map((l) => l.name)))].slice(0, 60);

  const raw = await aiCall({
    task: "plan",
    system: plannerSystemPrompt({
      today: todayContext(),
      labels: labelNames.map((n) => sanitizeForPrompt(n, 60)),
      hasCurrentThread: Boolean(req.context),
      accountEmails: accs.map((a) => a.email),
    }),
    // Only the user's own words reach the planner. No email content is included.
    prompt: `User instruction (from the user, trusted): ${sanitizeForPrompt(req.instruction, 1000)}`,
    schema: plannerSchema,
    maxOutputTokens: 900,
  });

  if (raw.intent === "question") {
    if (req.context) {
      const answer = await answerAboutThread(userId, req.context.accountId, req.context.threadId, req.instruction);
      return { kind: "answer", answer, citations: [] };
    }
    const r = await askInbox(userId, { question: req.instruction, account: req.account });
    return { kind: "answer", answer: r.answer, citations: r.citations, searched: r.searched, excluded: r.excluded };
  }
  if (raw.intent === "unclear") {
    return { kind: "clarify", message: raw.clarification || "Could you say a bit more precisely what you'd like me to do?" };
  }
  const v = validatePlan(raw, { instruction: req.instruction, hasCurrentThread: Boolean(req.context) });
  if (!v.ok) return { kind: "clarify", message: CLARIFY[v.reason] ?? CLARIFY.default! };

  return finalizePlan(userId, sessionId, policy, v.actions, v.notes, raw.summary, {
    accountParam: req.context ? req.context.accountId : req.account,
    context: req.context,
    accs,
    labelMaps,
  });
}

async function finalizePlan(
  userId: string,
  sessionId: string,
  policy: AiPolicy,
  actions: ValidAction[],
  notes: string[],
  summary: string,
  ctx: { accountParam?: string; context?: { accountId: string; threadId: string }; accs: AccountRow[]; labelMaps: LabelMap[] },
): Promise<CopilotReply> {
  const stored: StoredAction[] = [];
  const preview: PlanAction[] = [];
  for (const [i, a] of actions.entries()) {
    const r = await resolveAction(userId, policy, i, a, ctx);
    stored.push(r.stored);
    preview.push(r.preview);
  }
  if (notes.length && preview[0]) preview[0].note = [preview[0].note, ...notes].filter(Boolean).join(" ");

  const touched = stored.flatMap((s) => s.threads.map((t) => ({ accountId: t.accountId, threadId: t.threadId, subject: t.subject })));
  await recordAudit(userId, policy, "copilot_plan", touched.slice(0, 100), preview.reduce((n, p) => n + p.excluded, 0));

  const anyExecutable = stored.some((s) => s.executable);
  let planId: string | null = null;
  let expiresAt: string | null = null;
  if (anyExecutable) {
    const exp = new Date(Date.now() + COPILOT_LIMITS.planTtlSeconds * 1000);
    const [row] = await getDb().insert(copilotPlans).values({
      userId,
      sessionId,
      kind: "plan",
      dataEnc: encrypt(JSON.stringify({ v: 1, actions: stored } satisfies StoredPlan), "copilot", userId),
      expiresAt: exp,
    }).returning({ id: copilotPlans.id });
    planId = row!.id;
    expiresAt = exp.toISOString();
    // Expired or used plans (any user) are deleted, so subjects and draft text don't linger.
    await getDb().delete(copilotPlans).where(sql`${copilotPlans.expiresAt} < now() OR ${copilotPlans.usedAt} IS NOT NULL`);
  }
  const plan: PlanPreview = { planId, expiresAt, summary: summary.slice(0, 300), actions: preview };
  return { kind: "plan", plan };
}

const NUDGE_INSTRUCTIONS = {
  followup: "Write a short, friendly follow-up nudge on my last message, asking whether they had a chance to look at it. Two or three sentences.",
  reply: "Write a short reply that answers the open question in their last message. Where you don't know a fact, leave a clear [placeholder] instead of inventing it.",
} as const;

/**
 * One-click nudge from the follow-up radar: a fixed draft_reply plan on one conversation (no planner call).
 * It goes through the same preview → confirm → execute flow as any Copilot plan.
 */
export async function createNudgePlan(userId: string, sessionId: string, p: { accountId: string; threadId: string; kind: keyof typeof NUDGE_INSTRUCTIONS }): Promise<CopilotReply> {
  const policy = await loadPolicy(userId);
  const acc = await getOwnedAccount(userId, p.accountId);
  const action: ValidAction = { type: "draft_reply", target: "current_thread", gmailQuery: null, label: null, instruction: NUDGE_INSTRUCTIONS[p.kind], to: null };
  return finalizePlan(userId, sessionId, policy, [action], [], p.kind === "followup" ? "Draft a follow-up nudge." : "Draft a reply to their question.", {
    accountParam: acc.id,
    context: { accountId: acc.id, threadId: p.threadId },
    accs: [acc],
    labelMaps: [],
  });
}

const CLARIFY: Record<string, string> = {
  no_actions: "I couldn't turn that into an action on your mail. Try something like “archive newsletters from this week”.",
  too_many_actions: `That's more than ${COPILOT_LIMITS.maxActions} steps at once. Please split it into smaller requests.`,
  missing_target: "Which emails should I act on? Mention a sender, subject or time range, or open the conversation first.",
  bad_label: "That label name isn't valid. Use a short name like “Receipts”.",
  recipient_not_in_instruction: "To write a new email, type the recipient's email address in your request.",
  recipient_required: "To send a new email, type the recipient's email address in your request.",
  bad_query: "I couldn't build a safe search for that. Try rephrasing.",
  default: "I couldn't build a safe plan for that. Try rephrasing.",
};

interface LabelMap {
  accountId: string;
  byName: Map<string, { id: string; name: string }>; // lower-case name -> label
}

async function loadLabelMaps(accs: AccountRow[]): Promise<LabelMap[]> {
  return Promise.all(accs.map(async (a) => {
    try {
      const { labels } = await new GmailClient(a).request<{ labels?: Array<{ id: string; name: string; type: string }> }>("GET", "/labels");
      return { accountId: a.id, byName: new Map((labels ?? []).filter((l) => l.type === "user").map((l) => [l.name.toLowerCase(), { id: l.id, name: l.name }])) };
    } catch {
      return { accountId: a.id, byName: new Map() };
    }
  }));
}

function applicable(type: CopilotActionType, t: { labelIds: string[] }, labelId: string | null | undefined): boolean {
  const has = (l: string) => t.labelIds.includes(l);
  switch (type) {
    case "archive": return has("INBOX");
    case "unarchive": return !has("INBOX") && !has("TRASH") && !has("SPAM");
    case "star": return !has("STARRED");
    case "unstar": return has("STARRED");
    case "mark_read": return has("UNREAD");
    case "mark_unread": return !has("UNREAD");
    case "add_label": return labelId ? !has(labelId) : true;
    case "remove_label": return labelId ? has(labelId) : false;
    case "trash": return !has("TRASH");
    default: return true;
  }
}

const VERB: Partial<Record<CopilotActionType, string>> = {
  search: "Found", archive: "Archive", unarchive: "Move back to Inbox", star: "Star", unstar: "Unstar",
  mark_read: "Mark as read", mark_unread: "Mark as unread", trash: "Move to Trash",
};

function plural(n: number, w = "conversation") {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}

interface Candidate {
  accountId: string;
  threadId: string;
  from: Address;
  participants: Address[];
  subject: string;
  date: string;
  labelIds: string[];
  lastFromMe: boolean;
}

function fromSummary(t: ThreadSummary): Candidate {
  return { accountId: t.accountId, threadId: t.id, from: t.from, participants: t.participants, subject: t.subject, date: t.lastDate, labelIds: t.labelIds, lastFromMe: t.lastFromMe };
}

function fromDetail(t: ThreadDetail): Candidate {
  const real = t.messages.filter((m) => !m.isDraft);
  const last = real.at(-1) ?? t.messages.at(-1);
  return {
    accountId: t.accountId, threadId: t.id, from: last?.from ?? { name: "", email: "" }, participants: t.messages.map((m) => m.from),
    subject: t.subject, date: last?.date ?? "", labelIds: t.labelIds, lastFromMe: Boolean(last?.isFromMe),
  };
}

async function resolveAction(
  userId: string,
  policy: AiPolicy,
  index: number,
  a: ValidAction,
  ctx: { accountParam?: string; context?: { accountId: string; threadId: string }; accs: AccountRow[]; labelMaps: LabelMap[] },
): Promise<{ stored: StoredAction; preview: PlanAction }> {
  const risk: PlanAction["risk"] = a.type === "trash" ? "trash" : SEND_ACTIONS.has(a.type) ? "send" : a.type === "search" ? "none" : "normal";
  const base = { index, type: a.type, label: a.label, query: a.gmailQuery };
  const labelIds: Record<string, string | null> = {};
  for (const m of ctx.labelMaps) labelIds[m.accountId] = a.label ? (m.byName.get(a.label.toLowerCase())?.id ?? null) : null;

  // ---- create_label (no threads) ----
  if (a.type === "create_label") {
    const missing = ctx.labelMaps.filter((m) => !m.byName.has(a.label!.toLowerCase()));
    const title = `Create label “${a.label}”`;
    const stored: StoredAction = { ...pick(base), title, labelIds, threads: [], drafts: [], executable: missing.length > 0 };
    return { stored, preview: { ...base, title, threads: [], drafts: [], matched: 0, truncated: false, excluded: 0, risk, executable: missing.length > 0, note: missing.length ? null : "This label already exists." } };
  }

  // ---- new email drafts (no threads) ----
  if (a.type === "draft_new" || a.type === "send_new") {
    const acc = ctx.accs[0]!;
    const d = await draftEmail(userId, { mode: "new", instruction: a.instruction ?? undefined });
    const draft: StoredDraft = {
      key: `${acc.id}:new`, accountId: acc.id, threadId: null, from: await senderFrom(acc),
      to: a.to ? [a.to] : [], subject: (d.subject ?? "").slice(0, 200), body: d.body, inReplyTo: null, references: null,
    };
    const send = a.type === "send_new";
    const executable = !send || draft.to.length > 0;
    const title = send ? `Send a new email to ${a.to}` : `Create a draft${a.to ? ` to ${a.to}` : ""}`;
    return {
      stored: { ...pick(base), title, labelIds, threads: [], drafts: [draft], executable },
      preview: { ...base, title, threads: [], drafts: [publicDraft(draft)], matched: 1, truncated: false, excluded: 0, risk, executable, note: null },
    };
  }

  // ---- actions on existing conversations ----
  let candidates: Candidate[] = [];
  let truncated = false;
  if (a.target === "current_thread" && ctx.context) {
    candidates = [fromDetail(await getThread(userId, ctx.context.accountId, ctx.context.threadId))];
  } else if (a.gmailQuery) {
    const page = await listThreads(userId, {
      account: ctx.accountParam,
      folder: a.type === "unarchive" ? "archive" : "all",
      q: a.gmailQuery,
      limit: COPILOT_LIMITS.maxThreadsPerAction,
    });
    candidates = page.threads.map(fromSummary);
    truncated = page.nextCursor !== null;
  }
  const matched = candidates.length;
  const allowed = candidates.filter((t) => !isExcluded(policy, t.accountId, t));
  const excluded = matched - allowed.length;
  let targets = allowed.filter((t) => applicable(a.type, t, labelIds[t.accountId]));
  const skipped = allowed.length - targets.length;
  let note: string | null = null;
  if (excluded) note = `${plural(excluded)} skipped by your privacy exclusions.`;
  if (skipped && a.type !== "search") note = [note, `${plural(skipped)} already ${a.type === "archive" ? "archived" : "in that state"}.`].filter(Boolean).join(" ");
  if (truncated) note = [note, `More than ${COPILOT_LIMITS.maxThreadsPerAction} matched; only the first ${COPILOT_LIMITS.maxThreadsPerAction} are included.`].filter(Boolean).join(" ");

  let drafts: StoredDraft[] = [];
  if (a.type === "draft_reply" || a.type === "send_reply") {
    if (targets.length > COPILOT_LIMITS.maxDraftsPerAction) {
      note = [note, `Drafting is limited to ${COPILOT_LIMITS.maxDraftsPerAction} conversations at a time.`].filter(Boolean).join(" ");
      targets = targets.slice(0, COPILOT_LIMITS.maxDraftsPerAction);
    }
    drafts = (await mapLimit(targets, 2, (t) => buildReplyDraft(userId, t, a.instruction).catch((err) => {
      logger.warn({ err: err instanceof HttpError ? err.code : "error" }, "copilot_draft_failed");
      return null;
    }))).filter((d): d is StoredDraft => d !== null);
    targets = targets.filter((t) => drafts.some((d) => d.key === key(t.accountId, t.threadId)));
  }
  if (a.type === "remove_label" && Object.values(labelIds).every((v) => !v)) note = [note, `There's no label called “${a.label}”.`].filter(Boolean).join(" ");

  const threads: PlanThread[] = targets.map((t) => ({ key: key(t.accountId, t.threadId), accountId: t.accountId, threadId: t.threadId, from: shortName(t.from), subject: t.subject || "(no subject)", date: t.date }));
  const n = threads.length;
  const labelNew = a.type === "add_label" && threads.some((t) => !labelIds[t.accountId]);
  const title = a.type === "add_label" ? `Add label “${a.label}” to ${plural(n)}${labelNew ? " (new label)" : ""}`
    : a.type === "remove_label" ? `Remove label “${a.label}” from ${plural(n)}`
    : a.type === "draft_reply" ? `Draft ${n === 1 ? "a reply" : `${n} replies`}${n === 1 && drafts[0] ? ` to ${drafts[0].to.join(", ")}` : ""}`
    : a.type === "send_reply" ? `Send ${n === 1 ? "a reply" : `${n} replies`}${n === 1 && drafts[0] ? ` to ${drafts[0].to.join(", ")}` : ""}`
    : a.type === "search" ? `Found ${plural(n)}`
    : `${VERB[a.type]} ${plural(n)}`;
  const executable = a.type !== "search" && n > 0;
  if (n === 0 && !note) note = "Nothing matched, so there's nothing to do.";
  return {
    stored: { ...pick(base), title, labelIds, threads, drafts, executable },
    preview: { ...base, title, threads, drafts: drafts.map(publicDraft), matched, truncated, excluded, risk, executable, note },
  };
}

function pick(b: { index: number; type: CopilotActionType; label: string | null }) {
  return { index: b.index, type: b.type, label: b.label };
}

function publicDraft(d: StoredDraft): PlanDraft {
  return { key: d.key, accountId: d.accountId, threadId: d.threadId, from: d.from, to: d.to, subject: d.subject, body: d.body };
}

/**
 * Reply drafts: the model only writes the body text. Recipients, subject and threading headers come
 * from Gmail metadata on the server, so email content can't redirect a reply elsewhere.
 */
async function buildReplyDraft(userId: string, t: Candidate, instruction: string | null): Promise<StoredDraft> {
  const detail = await getThread(userId, t.accountId, t.threadId);
  const real = detail.messages.filter((m) => !m.isDraft);
  const lastOther = [...real].reverse().find((m) => !m.isFromMe);
  const last = real.at(-1);
  if (!last) throw badRequest("Empty conversation");
  const recipients = lastOther ? (lastOther.replyTo.length ? lastOther.replyTo : [lastOther.from]) : last.to;
  const to = [...new Set(recipients.map((r) => r.email.toLowerCase()))].slice(0, 10);
  if (!to.length) throw badRequest("No recipient");
  const anchor = lastOther ?? last;
  const d = await draftEmail(userId, { accountId: t.accountId, threadId: t.threadId, mode: "reply", instruction: instruction ?? undefined });
  const subject = /^re:/i.test(detail.subject) ? detail.subject : `Re: ${detail.subject}`;
  const acc = await getOwnedAccount(userId, t.accountId);
  return {
    key: key(t.accountId, t.threadId), accountId: t.accountId, threadId: t.threadId,
    from: await senderFrom(acc), to, subject: subject.slice(0, 250), body: d.body.slice(0, 8000),
    inReplyTo: anchor.messageIdHeader || null,
    references: [anchor.references, anchor.messageIdHeader].filter(Boolean).join(" ").slice(-3900) || null,
  };
}

// ---------------------------------------------------------------------------------------------
// Confirmation & execution
// ---------------------------------------------------------------------------------------------

async function loadOwnedRow(userId: string, sessionId: string, id: string, kind: "plan" | "undo") {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "plan_not_found", "This plan no longer exists.");
  const [row] = await getDb().select().from(copilotPlans).where(and(eq(copilotPlans.id, id), eq(copilotPlans.userId, userId), eq(copilotPlans.kind, kind))).limit(1);
  // Plans are bound to the session that created them; other sessions (and other users) see nothing.
  if (!row || row.sessionId !== sessionId) throw new HttpError(404, "plan_not_found", "This plan no longer exists.");
  if (row.usedAt) throw new HttpError(409, "plan_used", "This plan was already confirmed or cancelled.");
  if (row.expiresAt.getTime() <= Date.now()) throw new HttpError(410, "plan_expired", "This plan expired. Ask Copilot again.");
  return row;
}

/** Atomically marks the plan as used. Only one request can ever win. */
async function claim(id: string, userId: string): Promise<void> {
  // Claiming also wipes the encrypted payload: a used plan keeps only its id and timestamps.
  const r = await getDb().update(copilotPlans).set({ usedAt: new Date(), dataEnc: "" })
    .where(and(eq(copilotPlans.id, id), eq(copilotPlans.userId, userId), isNull(copilotPlans.usedAt), gt(copilotPlans.expiresAt, new Date())))
    .returning({ id: copilotPlans.id });
  if (!r.length) throw new HttpError(409, "plan_used", "This plan was already confirmed or cancelled.");
}

export async function cancelPlan(userId: string, sessionId: string, id: string): Promise<void> {
  await loadOwnedRow(userId, sessionId, id, "plan");
  await claim(id, userId);
}

const LABEL_OPS: Partial<Record<CopilotActionType, { add?: string[]; remove?: string[] }>> = {
  archive: { remove: ["INBOX"] },
  unarchive: { add: ["INBOX"] },
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  mark_read: { remove: ["UNREAD"] },
  mark_unread: { add: ["UNREAD"] },
};

export async function executePlan(userId: string, sessionId: string, id: string, req: ExecuteRequest): Promise<ExecuteResult> {
  const row = await loadOwnedRow(userId, sessionId, id, "plan");
  const plan = JSON.parse(decrypt(row.dataEnc, "copilot", userId)) as StoredPlan;

  // Validate the selection against the stored plan before anything runs or the plan is consumed.
  const chosen: Array<{ action: StoredAction; keys: Set<string> }> = [];
  const seen = new Set<number>();
  for (const sel of req.selections) {
    const action = plan.actions.find((x) => x.index === sel.index);
    if (!action || !action.executable || seen.has(sel.index)) throw badRequest("Invalid selection");
    seen.add(sel.index);
    const allowed = new Set([...action.threads.map((t) => t.key), ...action.drafts.map((d) => d.key)]);
    if (action.type === "create_label") {
      chosen.push({ action, keys: new Set() });
      continue;
    }
    const keys = new Set(sel.keys);
    if (!keys.size) continue;
    for (const k of keys) if (!allowed.has(k)) throw badRequest("Invalid selection");
    chosen.push({ action, keys });
  }
  if (!chosen.length) throw badRequest("Select at least one action to run.");
  if (chosen.some((c) => c.action.type === "trash") && !req.confirmTrash) throw new HttpError(409, "confirm_trash_required", "Moving to Trash needs an extra confirmation.");
  if (chosen.some((c) => SEND_ACTIONS.has(c.action.type)) && !req.confirmSend) throw new HttpError(409, "confirm_send_required", "Sending needs an extra confirmation.");

  // Re-check account ownership for every target before consuming the plan.
  const accountIds = new Set(chosen.flatMap((c) => [...c.action.threads, ...c.action.drafts].filter((t) => c.keys.has(t.key)).map((t) => t.accountId)));
  for (const c of chosen) if (c.action.type === "create_label") Object.keys(c.action.labelIds).forEach((a) => accountIds.add(a));
  const accs = new Map<string, AccountRow>();
  for (const aId of accountIds) accs.set(aId, await getOwnedAccount(userId, aId));

  await claim(id, userId);

  const policy = await loadPolicy(userId).catch(() => null);
  const clients = new Map<string, GmailClient>();
  const gm = (aId: string) => {
    let c = clients.get(aId);
    if (!c) clients.set(aId, (c = new GmailClient(accs.get(aId)!)));
    return c;
  };
  // Label ids created during this run (shared across actions in the plan).
  const created = new Map<string, string>(); // "<accountId>:<lower name>" -> id
  const ensureLabel = async (aId: string, name: string, known: string | null): Promise<string> => {
    if (known) return known;
    const k = `${aId}:${name.toLowerCase()}`;
    const hit = created.get(k);
    if (hit) return hit;
    const { labels } = await gm(aId).request<{ labels?: Array<{ id: string; name: string; type: string }> }>("GET", "/labels");
    const existing = (labels ?? []).find((l) => l.type === "user" && l.name.toLowerCase() === name.toLowerCase());
    const id = existing?.id ?? (await gm(aId).request<{ id: string }>("POST", "/labels", { body: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } })).id;
    created.set(k, id);
    return id;
  };

  const results: ActionResult[] = [];
  const undo: UndoOp[] = [];
  const audited: Array<{ accountId: string; threadId: string; subject: string }> = [];
  const order = [...chosen].sort((x, y) => (x.action.type === "create_label" ? -1 : 0) - (y.action.type === "create_label" ? -1 : 0) || x.action.index - y.action.index);

  for (const { action, keys } of order) {
    const res: ActionResult = { index: action.index, type: action.type, title: action.title, ok: 0, failed: 0, error: null };
    try {
      if (action.type === "create_label") {
        for (const aId of Object.keys(action.labelIds)) {
          if (!accs.has(aId)) continue;
          await ensureLabel(aId, action.label!, action.labelIds[aId] ?? null);
          res.ok++;
        }
      } else if (action.drafts.length) {
        const send = SEND_ACTIONS.has(action.type);
        for (const d of action.drafts.filter((x) => keys.has(x.key))) {
          try {
            const raw = toBase64Url(buildMime({
              from: d.from, to: d.to, cc: [], bcc: [], subject: d.subject, text: d.body, html: textToHtml(d.body),
              inReplyTo: d.inReplyTo ?? undefined, references: d.references ?? undefined, attachments: [],
            }));
            const message = { raw, ...(d.threadId ? { threadId: d.threadId } : {}) };
            if (send) await gm(d.accountId).request("POST", "/messages/send", { body: message });
            else await gm(d.accountId).request("POST", "/drafts", { body: { message } });
            res.ok++;
            if (d.threadId) audited.push({ accountId: d.accountId, threadId: d.threadId, subject: d.subject });
          } catch (err) {
            res.failed++;
            res.error = err instanceof HttpError ? err.message : "Gmail rejected the request.";
          }
        }
      } else {
        const targets = action.threads.filter((t) => keys.has(t.key));
        await mapLimit(targets, 4, async (t) => {
          try {
            if (action.type === "trash") {
              await gm(t.accountId).request("POST", `/threads/${t.threadId}/trash`);
              undo.push({ accountId: t.accountId, threadId: t.threadId, subject: t.subject, add: [], remove: [], untrash: true });
            } else {
              let add = LABEL_OPS[action.type]?.add ?? [];
              let remove = LABEL_OPS[action.type]?.remove ?? [];
              if (action.type === "add_label") add = [await ensureLabel(t.accountId, action.label!, action.labelIds[t.accountId] ?? null)];
              if (action.type === "remove_label") {
                const lid = action.labelIds[t.accountId];
                if (!lid) throw badRequest("Unknown label");
                remove = [lid];
              }
              await gm(t.accountId).request("POST", `/threads/${t.threadId}/modify`, { body: { addLabelIds: add, removeLabelIds: remove } });
              undo.push({ accountId: t.accountId, threadId: t.threadId, subject: t.subject, add: remove, remove: add });
            }
            res.ok++;
            audited.push({ accountId: t.accountId, threadId: t.threadId, subject: t.subject });
          } catch (err) {
            res.failed++;
            res.error = err instanceof HttpError ? err.message : "Gmail rejected the request.";
          }
        });
      }
    } catch (err) {
      res.failed = Math.max(res.failed, 1);
      res.error = err instanceof HttpError ? err.message : "Something went wrong.";
    }
    results.push(res);
  }
  results.sort((x, y) => x.index - y.index);

  if (policy) await recordAudit(userId, policy, "copilot_execute", audited.slice(0, 100));
  const undoRow = undo.length ? await storeUndo(userId, sessionId, undo) : null;
  return { results, undoId: undoRow?.id ?? null, undoExpiresAt: undoRow?.expiresAt ?? null, undoable: undo.length };
}

async function storeUndo(userId: string, sessionId: string, ops: UndoOp[]) {
  const exp = new Date(Date.now() + COPILOT_LIMITS.undoTtlSeconds * 1000);
  const [row] = await getDb().insert(copilotPlans).values({
    userId, sessionId, kind: "undo", dataEnc: encrypt(JSON.stringify({ v: 1, ops } satisfies StoredUndo), "copilot", userId), expiresAt: exp,
  }).returning({ id: copilotPlans.id });
  return { id: row!.id, expiresAt: exp.toISOString() };
}

export async function executeUndo(userId: string, sessionId: string, id: string): Promise<{ ok: number; failed: number }> {
  const row = await loadOwnedRow(userId, sessionId, id, "undo");
  const data = JSON.parse(decrypt(row.dataEnc, "copilot", userId)) as StoredUndo;
  const accs = new Map<string, GmailClient>();
  for (const aId of new Set(data.ops.map((o) => o.accountId))) accs.set(aId, new GmailClient(await getOwnedAccount(userId, aId)));
  await claim(id, userId);
  let ok = 0;
  let failed = 0;
  await mapLimit(data.ops, 4, async (o) => {
    try {
      const gm = accs.get(o.accountId)!;
      if (o.untrash) await gm.request("POST", `/threads/${o.threadId}/untrash`);
      else await gm.request("POST", `/threads/${o.threadId}/modify`, { body: { addLabelIds: o.add, removeLabelIds: o.remove } });
      ok++;
    } catch {
      failed++;
    }
  });
  const policy = await loadPolicy(userId).catch(() => null);
  if (policy) await recordAudit(userId, policy, "copilot_undo", data.ops.slice(0, 100).map((o) => ({ accountId: o.accountId, threadId: o.threadId, subject: o.subject })));
  return { ok, failed };
}

function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div>${esc.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

