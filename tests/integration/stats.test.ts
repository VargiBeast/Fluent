import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startHarness, type Harness } from "./harness.js";
import type { InboxStats } from "../../shared/stats.js";

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

describe("Inbox stats", () => {
  it("computes volume, top senders and response time from Gmail metadata", async () => {
    const r = await c.json<InboxStats>("/api/stats?days=30&tz=Europe/Oslo");
    expect(r.status).toBe(200);
    const s = r.body;
    expect(s).toMatchObject({ days: 30, timeZone: "Europe/Oslo", granularity: "day" });
    expect(s.volume).toHaveLength(30);
    const box = h.google.mailbox(ME);
    const monthAgo = Date.now() - 30 * 86400_000;
    const inbound = [...box.messages.values()].filter((m) => m.internalDate >= monthAgo && !["SENT", "DRAFT", "SPAM", "TRASH", "CHAT"].some((l) => m.labelIds.has(l)));
    expect(s.totals.received).toBe(inbound.length);
    expect(s.volume.reduce((n, b) => n + b.received, 0)).toBe(s.totals.received);
    expect(s.topSenders.length).toBeGreaterThan(0);
    expect(s.topSenders.every((t) => t.email !== ME)).toBe(true);
    expect(s.topSenders[0]!.count).toBeGreaterThanOrEqual(s.topSenders.at(-1)!.count);
    expect(s.byHour).toHaveLength(24);
    expect(s.sample).toMatchObject({ truncated: false });
    expect(s.errors).toEqual([]);
  });

  it("counts a reply sent from FLUENT as a response", async () => {
    const before = (await c.json<InboxStats>("/api/stats?days=7")).body;
    const send = await c.json("/api/compose/send", { method: "POST", body: JSON.stringify({ accountId, to: ["sofia@example.test"], subject: "Re: Q4 design review", html: "<p>Yes</p>", text: "Yes", threadId: "t-canary" }) });
    expect(send.status).toBe(200);
    const after = (await c.json<InboxStats>("/api/stats?days=7")).body;
    expect(after.totals.sent).toBe(before.totals.sent + 1);
    expect(after.response.replies).toBe(before.response.replies + 1);
    expect(after.response.averageMinutes).not.toBeNull();
  });

  it("validates the query", async () => {
    expect((await c.json("/api/stats?days=5")).status).toBe(400);
    expect((await c.json("/api/stats?tz=%3Cscript%3E")).status).toBe(400);
    expect((await c.json("/api/stats?account=nope")).status).toBe(400);
    expect((await c.json("/api/stats?days=7&extra=1")).status).toBe(400);
    // Unknown but well-formed zones fall back to UTC.
    expect((await c.json<InboxStats>("/api/stats?days=7&tz=Mars/Olympus")).body.timeZone).toBe("UTC");
  });

  it("requires sign-in and isolates accounts", async () => {
    expect((await new Client(h).json("/api/stats")).status).toBe(401);
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "8008", email: "oscar@fluent.test", name: "Oscar" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json(`/api/stats?account=${accountId}`)).status).toBe(404);
  });
});
