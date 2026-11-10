import { z } from "zod";
import { COPILOT_ACTIONS, COPILOT_LIMITS, SEND_ACTIONS, THREAD_ACTIONS_COPILOT, type CopilotActionType } from "../../shared/copilot.js";

/**
 * What the planner model may return. The planner only ever sees the user's own instruction plus
 * non-content context (label names, whether a conversation is open): never email content. So text
 * inside an email cannot add actions or change targets.
 */
export const plannerSchema = z.object({
  intent: z.enum(["actions", "question", "unclear"]),
  summary: z.string().max(300),
  clarification: z.string().max(300).nullable(),
  actions: z.array(z.object({
    type: z.enum(COPILOT_ACTIONS),
    target: z.enum(["query", "current_thread", "none"]),
    gmailQuery: z.string().max(300).nullable(),
    label: z.string().max(100).nullable(),
    instruction: z.string().max(1000).nullable(),
    to: z.string().max(320).nullable(),
  })).max(8),
});
export type PlannerOutput = z.infer<typeof plannerSchema>;

export interface ValidAction {
  type: CopilotActionType;
  target: "query" | "current_thread" | "none";
  gmailQuery: string | null;
  label: string | null;
  instruction: string | null;
  to: string | null;
}

export type PlanValidation =
  | { ok: true; actions: ValidAction[]; notes: string[] }
  | { ok: false; reason: string };

const EMAIL = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
const SEND_WORD = /\bsend\b|\bsend it\b|\bsend (?:a|an|the)\b/i;

export function validLabelName(name: string): boolean {
  const n = name.trim();
  return n.length > 0 && n.length <= 100 && !CONTROL.test(n) && !/^(INBOX|SPAM|TRASH|UNREAD|STARRED|IMPORTANT|SENT|DRAFT|CHAT)$/i.test(n) && !n.startsWith("CATEGORY_");
}

/**
 * Server-side gate between the model and Gmail. Enforces the allowlist, caps, target rules and
 * the "send only when the user said send" rule. Anything unexpected is rejected or downgraded.
 */
export function validatePlan(raw: PlannerOutput, ctx: { instruction: string; hasCurrentThread: boolean }): PlanValidation {
  if (raw.actions.length === 0) return { ok: false, reason: "no_actions" };
  if (raw.actions.length > COPILOT_LIMITS.maxActions) return { ok: false, reason: "too_many_actions" };
  const notes: string[] = [];
  const out: ValidAction[] = [];
  const userSaidSend = SEND_WORD.test(ctx.instruction);
  const instructionLower = ctx.instruction.toLowerCase();
  for (const a of raw.actions) {
    if (!(COPILOT_ACTIONS as readonly string[]).includes(a.type)) return { ok: false, reason: "unknown_action" };
    let type = a.type;
    if (SEND_ACTIONS.has(type) && !userSaidSend) {
      // The user never asked to send: keep it as a draft they can review in Gmail.
      type = type === "send_reply" ? "draft_reply" : "draft_new";
      notes.push("Sending was changed to drafting because your request didn't say “send”.");
    }
    const query = a.gmailQuery?.trim() || null;
    if (query && (CONTROL.test(query) || query.length > 300)) return { ok: false, reason: "bad_query" };
    let target = a.target;
    if (THREAD_ACTIONS_COPILOT.has(type)) {
      if (target === "current_thread" && !ctx.hasCurrentThread) target = query ? "query" : "none";
      if (target === "none" || (target === "query" && !query)) return { ok: false, reason: "missing_target" };
    } else {
      target = "none";
    }
    const label = a.label?.trim() || null;
    if (type === "add_label" || type === "remove_label" || type === "create_label") {
      if (!label || !validLabelName(label)) return { ok: false, reason: "bad_label" };
    }
    let to: string | null = null;
    if (type === "draft_new" || type === "send_new") {
      const t = a.to?.trim().toLowerCase() || null;
      // A new email may only go to an address the user typed themselves.
      if (t) {
        if (!EMAIL.test(t) || !instructionLower.includes(t)) return { ok: false, reason: "recipient_not_in_instruction" };
        to = t;
      } else if (type === "send_new") {
        return { ok: false, reason: "recipient_required" };
      }
    }
    const instruction = a.instruction?.trim().slice(0, 1000) || null;
    if (CONTROL.test(instruction?.replace(/[\n\t]/g, " ") ?? "")) return { ok: false, reason: "bad_instruction" };
    out.push({ type, target, gmailQuery: target === "query" ? query : null, label: label && (type === "add_label" || type === "remove_label" || type === "create_label") ? label : null,
      // If the model left out what to write, fall back to the user's own words.
      instruction: DRAFT_TYPES.has(type) ? (instruction ?? ctx.instruction.slice(0, 1000)) : null, to });
  }
  return { ok: true, actions: out, notes: [...new Set(notes)] };
}

const DRAFT_TYPES = new Set<CopilotActionType>(["draft_reply", "draft_new", "send_reply", "send_new"]);

export function plannerSystemPrompt(p: { today: string; labels: string[]; hasCurrentThread: boolean; accountEmails: string[] }): string {
  return [
    "You turn the user's instruction for their Gmail into a PLAN of actions. You never see email content.",
    p.today,
    `The user's accounts: ${p.accountEmails.join(", ")}. Their existing labels: ${p.labels.length ? p.labels.join(", ") : "(none)"}.`,
    p.hasCurrentThread ? "The user currently has a conversation open; use target \"current_thread\" when they say this email/this thread/this conversation." : "No conversation is open; never use target \"current_thread\".",
    "Allowed action types: search, archive, unarchive, star, unstar, mark_read, mark_unread, add_label, remove_label, create_label, trash, draft_reply, draft_new, send_reply, send_new.",
    "For actions on existing conversations set target \"query\" and a Gmail search query in gmailQuery (operators: from:, to:, subject:, label:, category:promotions|social|updates|forums, is:unread, is:starred, has:attachment, in:inbox, in:sent, newer_than:7d, older_than:, after:YYYY/MM/DD, OR, -, quotes). Prefer names and keywords over guessed addresses (from:sofia). Newsletters are usually category:promotions or category:forums.",
    "For labels put the label name in label. Replies: draft_reply with target and the gist of what to say in instruction. 'Follow up on unanswered/waiting threads' means draft_reply on in:sent threads where the user wrote last.",
    "Only use send_reply/send_new if the user explicitly says send; otherwise draft. New emails: put a recipient in to only if the user typed the email address.",
    "Use at most 5 actions. If the instruction is a question about their email rather than a request to change something, set intent \"question\" and no actions. If it is ambiguous or unsafe, set intent \"unclear\" with a short clarification question.",
    "summary: one short sentence describing the plan.",
  ].join("\n");
}
