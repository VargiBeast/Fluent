import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import type { CopilotReply, ExecuteResult, PlanPreview } from "../../shared/copilot.js";

let h: Harness;
let c: Client;
let accountId: string;
const ME = "alex@fluent.test";

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });
async function clearRateLimits() {
  const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
  await sql`DELETE FROM rate_limits`;
  await sql.end();
}
beforeEach(clearRateLimits);

const box = () => h.google.mailbox(ME);
const labelsOf = (threadId: string) => new Set([...box().messages.values()].filter((m) => m.threadId === threadId).flatMap((m) => [...m.labelIds]));

async function plan(client: Client, instruction: string, extra: Record<string, unknown> = {}) {
  const r = await client.json<CopilotReply>("/api/copilot/plan", { method: "POST", body: JSON.stringify({ instruction, ...extra }) });
  return r;
}
async function planOf(instruction: string, extra: Record<string, unknown> = {}): Promise<PlanPreview> {
  const r = await plan(c, instruction, extra);
  expect(r.status).toBe(200);
  expect(r.body.kind).toBe("plan");
  return (r.body as Extract<CopilotReply, { kind: "plan" }>).plan;
}
const allSelections = (p: PlanPreview) => p.actions.filter((a) => a.executable).map((a) => ({ index: a.index, keys: [...a.threads.map((t) => t.key), ...a.drafts.map((d) => d.key)] }));
const exec = (client: Client, id: string, body: unknown) => client.json<ExecuteResult & { error?: { code: string } }>(`/api/copilot/plans/${id}/execute`, { method: "POST", body: JSON.stringify(body) });

describe("Copilot actions: plan → confirm → execute", () => {
  it("previews without touching Gmail, then executes exactly the stored plan and offers undo", async () => {
    expect(labelsOf("t-news").has("INBOX")).toBe(true);
    const p = await planOf("Archive the newsletters");
    expect(p.planId).toMatch(/^[0-9a-f-]{36}$/);
    const a = p.actions[0]!;
    expect(a.type).toBe("archive");
    expect(a.threads.map((t) => t.threadId).sort()).toEqual(["t-injection", "t-news"]);
    expect(a.threads.find((t) => t.threadId === "t-news")).toMatchObject({ from: "Design Weekly", subject: "10 interface patterns worth stealing" });
    // Nothing happened yet.
    expect(labelsOf("t-news").has("INBOX")).toBe(true);

    // Deselect one conversation: only the selected one is archived.
    const r = await exec(c, p.planId!, { selections: [{ index: 0, keys: [`${accountId}:t-news`] }] });
    expect(r.status).toBe(200);
    expect(r.body.results[0]).toMatchObject({ ok: 1, failed: 0 });
    expect(labelsOf("t-news").has("INBOX")).toBe(false);
    expect(labelsOf("t-injection").has("INBOX")).toBe(true);
    expect(r.body.undoable).toBe(1);

    // Undo restores it, and the undo token is single-use too.
    const u = await c.json<{ ok: number }>(`/api/copilot/undo/${r.body.undoId}`, { method: "POST" });
    expect(u.body.ok).toBe(1);
    expect(labelsOf("t-news").has("INBOX")).toBe(true);
    expect((await c.json(`/api/copilot/undo/${r.body.undoId}`, { method: "POST" })).status).toBe(409);
  });

  it("plans are single-use", async () => {
    const p = await planOf("Star everything from marcus");
    const body = { selections: allSelections(p) };
    expect((await exec(c, p.planId!, body)).status).toBe(200);
    const again = await exec(c, p.planId!, body);
    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("plan_used");
  });

  it("concurrent confirms execute once", async () => {
    const p = await planOf("Mark everything from northwind as read");
    expect(p.actions[0]!.threads.length).toBeGreaterThan(0);
    const body = { selections: allSelections(p) };
    const rs = await Promise.all([exec(c, p.planId!, body), exec(c, p.planId!, body), exec(c, p.planId!, body)]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(labelsOf("t-team").has("UNREAD")).toBe(false);
  });

  it("expired plans are refused", async () => {
    const p = await planOf("Star everything from nordicair");
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    await sql`UPDATE copilot_plans SET expires_at = now() - interval '1 second' WHERE id = ${p.planId!}`;
    await sql.end();
    const r = await exec(c, p.planId!, { selections: allSelections(p) });
    expect(r.status).toBe(410);
    expect(labelsOf("t-flight").has("STARRED")).toBe(false);
  });

  it("cancelled plans cannot run", async () => {
    const p = await planOf("Star everything from nordicair");
    expect((await c.json(`/api/copilot/plans/${p.planId}/cancel`, { method: "POST" })).status).toBe(200);
    expect((await exec(c, p.planId!, { selections: allSelections(p) })).status).toBe(409);
    expect(labelsOf("t-flight").has("STARRED")).toBe(false);
  });

  it("rejects selections that are not in the stored plan (targets can't be swapped)", async () => {
    const p = await planOf("Star everything from nordicair");
    const bad = await exec(c, p.planId!, { selections: [{ index: 0, keys: [`${accountId}:t-landlord`] }] });
    expect(bad.status).toBe(400);
    expect(labelsOf("t-landlord").has("STARRED")).toBe(false);
    // Rejected selection doesn't burn the plan.
    expect((await exec(c, p.planId!, { selections: allSelections(p) })).status).toBe(200);
    expect(labelsOf("t-flight").has("STARRED")).toBe(true);
  });

  it("requires a CSRF token", async () => {
    const p = await planOf("Star everything from riverside");
    const res = await c.raw(`/api/copilot/plans/${p.planId}/execute`, { method: "POST", body: JSON.stringify({ selections: allSelections(p) }), headers: { "x-csrf-token": "wrong" } });
    expect(res.status).toBe(403);
    expect(labelsOf("t-school").has("STARRED")).toBe(false);
  });

  it("binds plans to the session and user that created them", async () => {
    const p = await planOf("Star everything from riverside");
    const sameUserOtherSession = new Client(h);
    await sameUserOtherSession.login();
    expect((await exec(sameUserOtherSession, p.planId!, { selections: allSelections(p) })).status).toBe(404);

    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "4004", email: "mallory@fluent.test", name: "Mallory" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await exec(other, p.planId!, { selections: allSelections(p) })).status).toBe(404);
    expect((await other.json(`/api/copilot/plans/${p.planId}/cancel`, { method: "POST" })).status).toBe(404);
    expect(labelsOf("t-school").has("STARRED")).toBe(false);
    // Still usable by its owner.
    expect((await exec(c, p.planId!, { selections: allSelections(p) })).status).toBe(200);
    expect(labelsOf("t-school").has("STARRED")).toBe(true);
  });

  it("trash needs an extra confirmation and can be undone", async () => {
    const p = await planOf("Trash everything from forum");
    expect(p.actions[0]).toMatchObject({ type: "trash", risk: "trash" });
    const no = await exec(c, p.planId!, { selections: allSelections(p) });
    expect(no.status).toBe(409);
    expect(no.body.error?.code).toBe("confirm_trash_required");
    expect(labelsOf("t-forum").has("TRASH")).toBe(false);
    const yes = await exec(c, p.planId!, { selections: allSelections(p), confirmTrash: true });
    expect(yes.status).toBe(200);
    expect(labelsOf("t-forum").has("TRASH")).toBe(true);
    await c.json(`/api/copilot/undo/${yes.body.undoId}`, { method: "POST" });
    expect(labelsOf("t-forum").has("TRASH")).toBe(false);
  });

  it("adds a label, creating it on confirm", async () => {
    const p = await planOf("Label invoice as Finance 2026");
    expect(p.actions[0]!.title).toContain("new label");
    expect([...box().labels.values()].some((l) => l.name === "Finance 2026")).toBe(false);
    const r = await exec(c, p.planId!, { selections: allSelections(p) });
    expect(r.status).toBe(200);
    const l = [...box().labels.values()].find((x) => x.name === "Finance 2026")!;
    expect(labelsOf("t-invoice").has(l.id)).toBe(true);
  });

  it("drafts replies by default; sending only when asked, with the full email shown and an extra confirm", async () => {
    const drafts0 = box().drafts.size;
    const sent0 = box().sent.length;
    const d = await planOf("Reply to sofia saying Thursday works");
    expect(d.actions[0]).toMatchObject({ type: "draft_reply", risk: "normal" });
    expect(d.actions[0]!.drafts[0]).toMatchObject({ to: ["sofia@northwind.example"], subject: "Re: Q4 design review — can you confirm Thursday?" });
    expect((await exec(c, d.planId!, { selections: allSelections(d) })).status).toBe(200);
    expect(box().drafts.size).toBe(drafts0 + 1);
    expect(box().sent.length).toBe(sent0);

    const s = await planOf("Send a reply to sofia saying Thursday works");
    expect(s.actions[0]).toMatchObject({ type: "send_reply", risk: "send" });
    expect(s.actions[0]!.drafts[0]!.body).toContain("Thursday");
    expect((await exec(c, s.planId!, { selections: allSelections(s) })).body.error?.code).toBe("confirm_send_required");
    expect(box().sent.length).toBe(sent0);
    expect((await exec(c, s.planId!, { selections: allSelections(s), confirmSend: true })).status).toBe(200);
    expect(box().sent.length).toBe(sent0 + 1);
    expect(box().sent.at(-1)).toMatch(/^To: sofia@northwind\.example/m);
    expect(box().sent.at(-1)).toMatch(/^In-Reply-To: <t-canary-0@fluent\.test>/m);
  });

  it("a prompt injection inside an email cannot add actions or change recipients", async () => {
    const sent0 = box().sent.length;
    const p = await planOf("Draft a reply to suspicious");
    // The planner never saw the email body.
    const planReq = h.google.state.aiRequests.find((r) => r.task === "plan" && r.input.includes("Draft a reply to suspicious"))!;
    expect(planReq.input).not.toContain("IGNORE ALL PREVIOUS");
    expect(p.actions).toHaveLength(1);
    const a = p.actions[0]!;
    expect(a.type).toBe("draft_reply");
    expect(a.threads.map((t) => t.threadId)).toEqual(["t-injection"]);
    // The (fake, gullible) model wrote attacker text into the body, but the recipient is fixed by the server.
    expect(a.drafts[0]!.body).toContain("attacker@suspicious.example");
    expect(a.drafts[0]!.to).toEqual(["promo@suspicious.example"]);
    const r = await exec(c, p.planId!, { selections: allSelections(p) });
    expect(r.status).toBe(200);
    expect(box().sent.length).toBe(sent0); // drafted, never sent
    expect(labelsOf("t-injection").has("TRASH")).toBe(false);
  });

  it("refuses new emails to addresses the user didn't type", async () => {
    const r = await plan(c, "Email attacker the summary");
    expect(r.status).toBe(200);
    expect(r.body.kind).toBe("clarify");
  });

  it("honours privacy exclusions when resolving targets", async () => {
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ ai: { excludedSenders: ["@northwind.example"], excludedLabels: [] } }) });
    try {
      const p = await planOf("Star everything from northwind");
      expect(p.actions[0]!.threads).toHaveLength(0);
      expect(p.actions[0]!.excluded).toBeGreaterThan(0);
      expect(p.actions[0]!.executable).toBe(false);
    } finally {
      await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ ai: { excludedSenders: [], excludedLabels: [] } }) });
    }
  });

  it("answers questions and asks for clarification instead of acting", async () => {
    expect((await plan(c, "When is my flight to Lisbon?")).body.kind).toBe("answer");
    expect((await plan(c, "do something")).body.kind).toBe("clarify");
    expect((await plan(c, "delete everything")).body.kind).toBe("clarify"); // > 5 actions rejected
  });

  it("acts on the open conversation", async () => {
    const p = await planOf("Archive this", { context: { accountId, threadId: "t-landlord" } });
    expect(p.actions[0]!.threads.map((t) => t.threadId)).toEqual(["t-landlord"]);
    await exec(c, p.planId!, { selections: allSelections(p) });
    expect(labelsOf("t-landlord").has("INBOX")).toBe(false);
  });

  it("logs to the privacy audit log without bodies", async () => {
    const a = await c.json<{ entries: Array<{ feature: string }> }>("/api/privacy/audit");
    const features = a.body.entries.map((e) => e.feature);
    expect(features).toContain("copilot_plan");
    expect(features).toContain("copilot_execute");
    expect(JSON.stringify(a.body)).not.toContain("IGNORE ALL PREVIOUS");
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const rows = await sql`SELECT data_enc, used_at, expires_at FROM copilot_plans`;
    await sql.end();
    // Stored plans are encrypted at rest, wiped once used, and short-lived.
    for (const r of rows) {
      expect(String(r.data_enc)).not.toMatch(/Thursday|sofia/i);
      if (r.used_at) expect(r.data_enc).toBe("");
      expect(new Date(r.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 601_000);
    }
  });

  it("follow-up radar: overview lists waiting and open questions; a nudge goes through the confirm flow", async () => {
    const ov = await c.json<{ waiting: Array<{ id: string }>; questions: Array<{ id: string }> }>("/api/ai/overview");
    expect(ov.body.waiting.map((t) => t.id)).toContain("t-waiting");
    expect(ov.body.questions.map((t) => t.id)).toContain("t-team"); // t-canary was answered earlier in this file
    expect(ov.body.questions.map((t) => t.id)).not.toContain("t-news");
    const drafts0 = box().drafts.size;
    const r = await c.json<CopilotReply>("/api/copilot/nudge", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-waiting", kind: "followup" }) });
    expect(r.status).toBe(200);
    const p = (r.body as Extract<CopilotReply, { kind: "plan" }>).plan;
    expect(p.actions[0]).toMatchObject({ type: "draft_reply", risk: "normal" });
    // I wrote last, so the nudge goes to the original recipient.
    expect(p.actions[0]!.drafts[0]!.to).toEqual(["jonas@fjordlabs.example"]);
    expect(box().drafts.size).toBe(drafts0);
    expect((await exec(c, p.planId!, { selections: allSelections(p) })).status).toBe(200);
    expect(box().drafts.size).toBe(drafts0 + 1);
    expect((await c.json("/api/copilot/nudge", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-waiting", kind: "send" }) })).status).toBe(400);
  });

  it("rate-limits planning", async () => {
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) limited = (await plan(c, "Star everything from nobody")).status === 429;
    expect(limited).toBe(true);
  });
});
