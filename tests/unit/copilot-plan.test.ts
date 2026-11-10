import { describe, expect, it } from "vitest";
import { plannerSchema, validatePlan, validLabelName, type PlannerOutput } from "../../server/copilot/plan.js";
import { COPILOT_ACTIONS, COPILOT_LIMITS } from "../../shared/copilot.js";

type A = PlannerOutput["actions"][number];
const a = (x: Partial<A>): A => ({ type: "archive", target: "query", gmailQuery: "from:x", label: null, instruction: null, to: null, ...x });
const raw = (actions: A[]): PlannerOutput => ({ intent: "actions", summary: "s", clarification: null, actions });
const v = (actions: A[], instruction = "do it", hasCurrentThread = false) => validatePlan(raw(actions), { instruction, hasCurrentThread });

describe("validatePlan", () => {
  it("only allows the allowlisted action types", () => {
    expect(COPILOT_ACTIONS).not.toContain("forward");
    expect(COPILOT_ACTIONS).not.toContain("delete");
    expect(plannerSchema.safeParse(raw([a({ type: "forward" as A["type"] })])).success).toBe(false);
    expect(plannerSchema.safeParse(raw([a({ type: "delete_forever" as A["type"] })])).success).toBe(false);
    expect(v([a({ type: "filter" as A["type"] })])).toEqual({ ok: false, reason: "unknown_action" });
  });

  it("caps the number of actions", () => {
    expect(v([])).toEqual({ ok: false, reason: "no_actions" });
    expect(v(Array.from({ length: COPILOT_LIMITS.maxActions }, () => a({}))).ok).toBe(true);
    expect(v(Array.from({ length: COPILOT_LIMITS.maxActions + 1 }, () => a({})))).toEqual({ ok: false, reason: "too_many_actions" });
    expect(COPILOT_LIMITS.maxThreadsPerAction).toBe(50);
  });

  it("requires a target for thread actions", () => {
    expect(v([a({ gmailQuery: null })])).toEqual({ ok: false, reason: "missing_target" });
    expect(v([a({ target: "none" })])).toEqual({ ok: false, reason: "missing_target" });
    // current_thread falls back to the query when nothing is open, and is rejected without one.
    expect(v([a({ target: "current_thread", gmailQuery: null })])).toEqual({ ok: false, reason: "missing_target" });
    const ok = v([a({ target: "current_thread", gmailQuery: "from:y" })]);
    expect(ok.ok && ok.actions[0]!.target).toBe("query");
    const cur = v([a({ target: "current_thread", gmailQuery: null })], "archive this", true);
    expect(cur.ok && cur.actions[0]!.target).toBe("current_thread");
  });

  it("rejects control characters in queries", () => {
    expect(v([a({ gmailQuery: "from:x\u0000" })])).toEqual({ ok: false, reason: "bad_query" });
  });

  it("downgrades send to draft unless the user said send", () => {
    const r = v([a({ type: "send_reply", instruction: "yes" })], "reply to sofia yes");
    expect(r.ok && r.actions[0]!.type).toBe("draft_reply");
    expect(r.ok && r.notes.length).toBe(1);
    const s = v([a({ type: "send_reply", instruction: "yes" })], "send a reply to sofia");
    expect(s.ok && s.actions[0]!.type).toBe("send_reply");
    const sender = v([a({ type: "send_reply" })], "reply to the sender");
    expect(sender.ok && sender.actions[0]!.type).toBe("draft_reply");
  });

  it("only lets new emails go to addresses the user typed", () => {
    expect(v([a({ type: "draft_new", target: "none", gmailQuery: null, to: "attacker@evil.example" })], "email bob the notes")).toEqual({ ok: false, reason: "recipient_not_in_instruction" });
    const ok = v([a({ type: "draft_new", target: "none", gmailQuery: null, to: "Bob@Example.com" })], "email bob@example.com the notes");
    expect(ok.ok && ok.actions[0]!.to).toBe("bob@example.com");
    expect(v([a({ type: "send_new", target: "none", gmailQuery: null })], "send an email")).toEqual({ ok: false, reason: "recipient_required" });
    expect(v([a({ type: "draft_new", target: "none", gmailQuery: null, to: "not-an-email" })], "not-an-email")).toEqual({ ok: false, reason: "recipient_not_in_instruction" });
  });

  it("validates labels", () => {
    expect(v([a({ type: "add_label", label: null })])).toEqual({ ok: false, reason: "bad_label" });
    expect(v([a({ type: "add_label", label: "TRASH" })])).toEqual({ ok: false, reason: "bad_label" });
    expect(v([a({ type: "create_label", target: "none", gmailQuery: null, label: "Receipts" })]).ok).toBe(true);
    expect(validLabelName("CATEGORY_SOCIAL")).toBe(false);
    expect(validLabelName("a\nb")).toBe(false);
    expect(validLabelName("x".repeat(101))).toBe(false);
    expect(validLabelName("Travel/2026")).toBe(true);
  });

  it("falls back to the user's words when a draft has no instruction", () => {
    const r = v([a({ type: "draft_reply", target: "current_thread", gmailQuery: null, instruction: null })], "draft a reply saying Thursday works", true);
    expect(r.ok && r.actions[0]!.instruction).toBe("draft a reply saying Thursday works");
  });

  it("strips fields that don't belong to the action", () => {
    const r = v([a({ type: "archive", label: "Foo", instruction: "x", to: "a@b.co" })]);
    expect(r.ok && r.actions[0]).toMatchObject({ label: null, instruction: null, to: null });
    const c = v([a({ type: "create_label", gmailQuery: "from:x", label: "Foo" })]);
    expect(c.ok && c.actions[0]).toMatchObject({ target: "none", gmailQuery: null });
  });
});
