import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { localDay } from "../../server/ai/brief.js";

let h: Harness;
let c: Client;
let accountId: string;

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });

type Item = { thread: { id: string; starred: boolean; important: boolean }; reason: string };
type Brief = { day: string; cached: boolean; headline: string | null; aiStatus: string; excluded: number; important: Item[]; awaitingReply: Item[]; safeToArchive: Item[] };
const ai = () => h.google.state.aiRequests;
const ids = (xs: Item[]) => xs.map((x) => x.thread.id);
const all = (b: Brief) => [...b.important, ...b.awaitingReply, ...b.safeToArchive];
const audit = async () => (await c.json<{ entries: Array<{ feature: string }> }>("/api/privacy/audit")).body.entries.filter((e) => e.feature === "daily_brief").length;

describe("daily brief", () => {
  it("generates once per local day in the user's language, then serves the encrypted cache", async () => {
    const before = ai().length;
    const r = await c.json<Brief>("/api/ai/brief?tz=Europe/Oslo&lang=nb-NO");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ aiStatus: "ok", cached: false, day: localDay("Europe/Oslo") });
    expect(r.body.headline).toMatch(/God morgen/);
    expect(ai().length).toBe(before + 1);
    const req = ai().at(-1)!;
    expect(req.task).toBe("brief");
    expect(JSON.stringify(req.body)).toContain("in Norwegian");
    // Bulk mail is offered for archiving; starred/important mail never is, even when the model suggests it.
    expect(ids(r.body.safeToArchive)).toEqual(expect.arrayContaining(["t-news", "t-social", "t-forum"]));
    expect(r.body.safeToArchive.every((x) => !x.thread.starred && !x.thread.important)).toBe(true);
    expect(ids(r.body.safeToArchive)).not.toContain("t-canary");
    expect(all(r.body).length).toBeGreaterThan(3);
    expect(await audit()).toBe(1);

    const again = await c.json<Brief>("/api/ai/brief?tz=Europe/Oslo&lang=nb-NO");
    expect(again.body.cached).toBe(true);
    expect(again.body.headline).toBe(r.body.headline);
    expect(ai().length).toBe(before + 1); // no second model call
    expect(await audit()).toBe(1); // nothing new was read

    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const rows = await sql<Array<{ payload_enc: string }>>`select payload_enc from daily_briefs`;
    await sql.end();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload_enc).not.toMatch(/God morgen|interface patterns|Design Weekly/);
  });

  it("regenerates when privacy exclusions change and never sends excluded mail to the model", async () => {
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ ai: { excludedSenders: ["@northwind.example"] } }) });
    const r = await c.json<Brief>("/api/ai/brief?tz=Europe/Oslo&lang=nb-NO");
    expect(r.body.cached).toBe(false);
    expect(r.body.excluded).toBeGreaterThan(0);
    expect(ids(all(r.body))).not.toEqual(expect.arrayContaining(["t-canary"]));
    expect(ids(all(r.body))).not.toContain("t-team");
    expect(ai().at(-1)!.input).not.toContain("Q4 design review");
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ ai: { excludedSenders: [] } }) });
  });

  it("refresh=1 rebuilds; English when the browser language is English", async () => {
    const r = await c.json<Brief>("/api/ai/brief?tz=Europe/Oslo&lang=en-GB&refresh=1");
    expect(r.body.cached).toBe(false);
    expect(r.body.headline).toMatch(/Good morning/);
  });

  it("falls back to Gmail-only triage when AI is off (no model call, nothing cached)", async () => {
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ ai: { enabled: false } }) });
    const before = ai().length;
    const r = await c.json<Brief>("/api/ai/brief?tz=UTC");
    expect(r.body).toMatchObject({ aiStatus: "disabled", headline: null, cached: false });
    expect(ids(r.body.safeToArchive)).toEqual(expect.arrayContaining(["t-news", "t-forum"]));
    expect(ids([...r.body.important, ...r.body.awaitingReply])).toContain("t-canary");
    expect(ai().length).toBe(before);
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ ai: { enabled: true } }) });
  });

  it("validates input and clears the cache with the AI history", async () => {
    expect((await c.json("/api/ai/brief?tz=Europe/Oslo;drop")).status).toBe(400);
    expect((await c.json("/api/ai/brief?lang=<script>")).status).toBe(400);
    expect((await c.json("/api/ai/brief?foo=1")).status).toBe(400);
    const data = async () => (await c.json<{ stored: Array<{ key: string; count: number }> }>("/api/privacy/data")).body.stored.find((s) => s.key === "daily_briefs")!.count;
    expect(await data()).toBeGreaterThan(0);
    await c.json("/api/privacy/audit", { method: "DELETE" });
    expect(await data()).toBe(0);
  });

  it("a second user can't see the first user's brief", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "3004", email: "eve@fluent.test", name: "Eve" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    const r = await other.json<Brief>("/api/ai/brief?tz=Europe/Oslo");
    expect(r.status).toBe(200);
    expect(r.body.cached).toBe(false); // Alex's cached brief for today is not served to Eve
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const rows = await sql<Array<{ n: number }>>`select count(distinct user_id)::int as n from daily_briefs`;
    await sql.end();
    expect(rows[0]!.n).toBe(1); // only Eve's (Alex cleared his history above)
  });
});

describe("ask your inbox", () => {
  type Ask = { found: boolean; answer: string; citations: Array<{ id: string; accountId: string; subject: string }>; gmailQuery: string | null; queries: string[] };

  it("translates the question into validated Gmail queries and answers with real sources", async () => {
    const r = await c.json<Ask>("/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "What did Brightline say about the invoice in October?" }) });
    expect(r.status).toBe(200);
    expect(r.body.queries).toEqual(["invoice newer_than:60d", "invoice"]); // label:"unclosed was rejected
    expect(r.body.gmailQuery).toBe("invoice newer_than:60d");
    expect(r.body.found).toBe(true);
    expect(r.body.citations.length).toBeGreaterThan(0);
    expect(r.body.citations.every((t) => t.accountId === accountId && /invoice|receipt/i.test(t.subject))).toBe(true);
    expect(ai().at(-1)!.task).toBe("ask");
  });

  it("says so when nothing matches, in the question's language, without inventing an answer", async () => {
    const before = ai().length;
    const r = await c.json<Ask>("/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "Hva sa de om zebra unicorn?" }) });
    expect(r.body).toMatchObject({ found: false, citations: [], answer: "Jeg fant ingen e-poster om det." });
    expect(r.body.queries).toEqual(["zebra unicorn"]); // the URL query was dropped
    expect(ai().length).toBe(before + 1); // only the planning call; no answer call with unrelated mail
    expect(ai().at(-1)!.task).toBe("ask_plan");
  });

  it("works from Copilot too (citations are threads the user owns)", async () => {
    const r = await c.json<{ kind: string; found: boolean; citations: Array<{ id: string }>; gmailQuery: string }>("/api/copilot/plan", { method: "POST", body: JSON.stringify({ instruction: "What does the invoice say?" }) });
    expect(r.body.kind).toBe("answer");
    expect(r.body.found).toBe(true);
    expect(r.body.gmailQuery).toBe("invoice newer_than:60d");
  });

  it("is rate-limited", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await c.json("/api/ai/ask", { method: "POST", body: JSON.stringify({ question: "zebra unicorn?" }) })).status);
    expect(codes).toContain(429);
  });
});
