import type { CopilotReply, PlanPreview } from "@shared/copilot";
import type { ThreadSummary } from "@shared/mail";

/** Body accepted by POST /api/copilot/plan (see server/routes/copilot.ts). */
export interface CopilotPlanBody {
  instruction: string;
  context?: { accountId: string; threadId: string };
  account?: "all" | string;
}

/** Build the plan request from the user's message and optional open-thread scope. */
export function buildCopilotPlanBody(
  instruction: string,
  scope?: { accountId: string; threadId: string } | null,
): CopilotPlanBody {
  const body: CopilotPlanBody = { instruction };
  if (scope) body.context = { accountId: scope.accountId, threadId: scope.threadId };
  return body;
}

export type CopilotUiMessage =
  | { role: "plan"; plan: PlanPreview }
  | { role: "assistant"; text: string; citations?: ThreadSummary[] };

/** Map a successful CopilotReply into a UI message. Uses `answer` / `message`, never `text`. */
export function mapCopilotReply(res: CopilotReply): CopilotUiMessage {
  if (res.kind === "plan") return { role: "plan", plan: res.plan };
  if (res.kind === "answer") return { role: "assistant", text: res.answer, citations: res.citations };
  return { role: "assistant", text: res.message };
}
