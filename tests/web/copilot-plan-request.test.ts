import { describe, expect, it } from "vitest";
import type { CopilotReply } from "../../shared/copilot";
import { buildCopilotPlanBody, mapCopilotReply } from "../../web/src/app/copilot/planRequest";

describe("buildCopilotPlanBody", () => {
  it("sends instruction (not message) for POST /copilot/plan", () => {
    expect(buildCopilotPlanBody("What needs my attention today?")).toEqual({
      instruction: "What needs my attention today?",
    });
  });

  it("nests account/thread under context when the open conversation is in scope", () => {
    expect(
      buildCopilotPlanBody("Draft a reply saying yes", {
        accountId: "11111111-1111-1111-1111-111111111111",
        threadId: "t-team",
      }),
    ).toEqual({
      instruction: "Draft a reply saying yes",
      context: {
        accountId: "11111111-1111-1111-1111-111111111111",
        threadId: "t-team",
      },
    });
  });

  it("omits context when scope is null", () => {
    expect(buildCopilotPlanBody("Star everything from Sofia", null)).toEqual({
      instruction: "Star everything from Sofia",
    });
  });
});

describe("mapCopilotReply", () => {
  it("maps answer.kind using answer, not text", () => {
    const res: CopilotReply = {
      kind: "answer",
      answer: "You have two messages that need a reply.",
      citations: [
        {
          id: "t1",
          accountId: "a1",
          subject: "Q4 design review",
          snippet: "",
          participants: [{ name: "Sofia", email: "sofia@example.com" }],
          from: { name: "Sofia", email: "sofia@example.com" },
          to: [],
          lastDate: "2026-11-13T10:00:00.000Z",
          messageCount: 1,
          unread: true,
          starred: false,
          important: true,
          hasAttachments: false,
          labelIds: ["INBOX"],
          lastFromMe: false,
        },
      ],
    };
    const ui = mapCopilotReply(res);
    expect(ui).toEqual({
      role: "assistant",
      text: "You have two messages that need a reply.",
      citations: res.citations,
    });
    expect(ui).not.toHaveProperty("answer");
  });

  it("maps plan.kind to a plan message", () => {
    const res: CopilotReply = {
      kind: "plan",
      plan: {
        planId: "p1",
        expiresAt: "2026-11-13T12:00:00.000Z",
        summary: "Star 1 conversation",
        actions: [],
      },
    };
    expect(mapCopilotReply(res)).toEqual({ role: "plan", plan: res.plan });
  });

  it("maps clarify.kind using message", () => {
    const res: CopilotReply = {
      kind: "clarify",
      message: "Could you say a bit more precisely what you'd like me to do?",
    };
    expect(mapCopilotReply(res)).toEqual({
      role: "assistant",
      text: "Could you say a bit more precisely what you'd like me to do?",
    });
  });
});
