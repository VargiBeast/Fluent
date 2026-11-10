import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

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

const labelsOf = (threadId: string) => new Set([...h.google.mailbox(ME).messages.values()].filter((m) => m.threadId === threadId).flatMap((m) => [...m.labelIds]));
const snoozedLabel = () => [...h.google.mailbox(ME).labels.values()].find((l) => l.name === "Snoozed")?.id;
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
async function makeDue(threadId: string) {
  const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
  await sql`UPDATE snoozes SET due_at = now() - interval '1 second' WHERE thread_id = ${threadId}`;
  await sql.end();
}

describe("Snooze and reminders", () => {
  it("snoozes out of the Inbox into the Snoozed folder and returns on the next sync after it's due", async () => {
    const r = await c.json<{ kind: string }>("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-landlord", until: inMinutes(60), kind: "snooze" }) });
    expect(r.status).toBe(200);
    expect(labelsOf("t-landlord").has("INBOX")).toBe(false);
    expect(labelsOf("t-landlord").has(snoozedLabel()!)).toBe(true);
    const folder = await c.json<{ threads: Array<{ id: string }> }>("/api/mail/threads?folder=snoozed");
    expect(folder.body.threads.map((t) => t.id)).toEqual(["t-landlord"]);
    const list = await c.json<{ snoozes: Array<{ threadId: string; kind: string }> }>("/api/mail/snoozes");
    expect(list.body.snoozes).toMatchObject([{ threadId: "t-landlord", kind: "snooze" }]);

    // Not due yet: sync leaves it alone.
    expect((await c.json<{ snoozeReturned: number }>("/api/mail/sync")).body.snoozeReturned).toBe(0);
    await makeDue("t-landlord");
    const s = await c.json<{ snoozeReturned: number; changed: boolean }>("/api/mail/sync");
    expect(s.body).toMatchObject({ snoozeReturned: 1, changed: true });
    expect(labelsOf("t-landlord").has("INBOX")).toBe(true);
    expect(labelsOf("t-landlord").has("UNREAD")).toBe(true);
    expect(labelsOf("t-landlord").has(snoozedLabel()!)).toBe(false);
    // Processed once only.
    expect((await c.json<{ snoozeReturned: number }>("/api/mail/sync")).body.snoozeReturned).toBe(0);
  });

  it("unsnoozing returns the conversation immediately", async () => {
    await c.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-school", until: inMinutes(600), kind: "snooze" }) });
    expect(labelsOf("t-school").has("INBOX")).toBe(false);
    expect((await c.json(`/api/mail/snoozes/${accountId}/t-school`, { method: "DELETE" })).status).toBe(200);
    expect(labelsOf("t-school").has("INBOX")).toBe(true);
  });

  it("reminds only when nobody replied", async () => {
    await c.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-waiting", until: inMinutes(60), kind: "remind" }) });
    expect(labelsOf("t-waiting").has("INBOX")).toBe(false); // reminders don't move anything now
    await makeDue("t-waiting");
    const s = await c.json<{ remindersDue: number }>("/api/mail/sync");
    expect(s.body.remindersDue).toBe(1);
    expect(labelsOf("t-waiting").has("INBOX")).toBe(true);
    expect(labelsOf("t-waiting").has("STARRED")).toBe(true);

    // A thread where the other person wrote last: no reminder fires.
    await c.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-flight", until: inMinutes(60), kind: "remind" }) });
    await makeDue("t-flight");
    expect((await c.json<{ remindersDue: number }>("/api/mail/sync")).body.remindersDue).toBe(0);
    expect(labelsOf("t-flight").has("STARRED")).toBe(false);
  });

  it("validates times and ownership", async () => {
    const past = await c.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-news", until: new Date(Date.now() - 1000).toISOString(), kind: "snooze" }) });
    expect(past.status).toBe(400);
    const far = await c.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-news", until: new Date(Date.now() + 400 * 86400_000).toISOString(), kind: "snooze" }) });
    expect(far.status).toBe(400);
    expect((await c.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-news", until: inMinutes(60), kind: "forever" }) })).status).toBe(400);

    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "5005", email: "trudy@fluent.test", name: "Trudy" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json("/api/mail/snoozes", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-news", until: inMinutes(60), kind: "snooze" }) })).status).toBe(404);
    expect(labelsOf("t-news").has("INBOX")).toBe(true);
    expect((await other.json<{ snoozes: unknown[] }>("/api/mail/snoozes")).body.snoozes).toHaveLength(0);
  });
});
