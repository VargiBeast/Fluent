/** Copilot action plans: types shared by the API and the web app. */
import type { ThreadSummary } from "./mail.js";

export const COPILOT_ACTIONS = [
  "search", "archive", "unarchive", "star", "unstar", "mark_read", "mark_unread",
  "add_label", "remove_label", "create_label", "trash", "draft_reply", "draft_new", "send_reply", "send_new",
] as const;
export type CopilotActionType = (typeof COPILOT_ACTIONS)[number];

/** Actions that act on a set of existing conversations. */
export const THREAD_ACTIONS_COPILOT: ReadonlySet<CopilotActionType> = new Set([
  "search", "archive", "unarchive", "star", "unstar", "mark_read", "mark_unread", "add_label", "remove_label", "trash", "draft_reply", "send_reply",
]);
export const DRAFT_ACTIONS: ReadonlySet<CopilotActionType> = new Set(["draft_reply", "draft_new", "send_reply", "send_new"]);
export const SEND_ACTIONS: ReadonlySet<CopilotActionType> = new Set(["send_reply", "send_new"]);

export const COPILOT_LIMITS = {
  maxActions: 5,
  maxThreadsPerAction: 50,
  maxDraftsPerAction: 5,
  planTtlSeconds: 10 * 60,
  undoTtlSeconds: 10 * 60,
} as const;

export interface PlanThread {
  key: string; // "<accountId>:<threadId>"
  accountId: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
}

export interface PlanDraft {
  key: string; // "<accountId>:<threadId>" for replies, "<accountId>:new" for new emails
  accountId: string;
  threadId: string | null;
  from: string;
  to: string[];
  subject: string;
  body: string;
}

export interface PlanAction {
  index: number;
  type: CopilotActionType;
  title: string;
  query: string | null;
  label: string | null;
  threads: PlanThread[];
  drafts: PlanDraft[];
  matched: number;
  truncated: boolean;
  excluded: number;
  /** "trash" and "send" need an extra explicit confirmation. */
  risk: "none" | "normal" | "trash" | "send";
  executable: boolean;
  note: string | null;
}

export interface PlanPreview {
  planId: string | null;
  expiresAt: string | null;
  summary: string;
  actions: PlanAction[];
}

export type CopilotReply =
  | { kind: "plan"; plan: PlanPreview }
  | { kind: "answer"; answer: string; citations: ThreadSummary[]; searched?: number; excluded?: number }
  | { kind: "clarify"; message: string };

export interface ExecuteRequest {
  selections: Array<{ index: number; keys: string[] }>;
  confirmTrash?: boolean;
  confirmSend?: boolean;
}

export interface ActionResult {
  index: number;
  type: CopilotActionType;
  title: string;
  ok: number;
  failed: number;
  error: string | null;
}

export interface ExecuteResult {
  results: ActionResult[];
  undoId: string | null;
  undoExpiresAt: string | null;
  undoable: number;
}
