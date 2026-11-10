import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

let h: Harness;
let c: Client;
let accountId: string;
const ME = "alex@fluent.test";

interface Item { accountId: string; threadId: string; addedAt: string }
interface Page { threads: Array<{ id: string; subject: string }>; nextCursor: string | null; errors: unknown[] }

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });

const add = (cl: Client, threadId: string, acc = accountId) => cl.json<Item>("/api/mail/read-later", { method: "POST", body: JSON.stringify({ accountId: acc, threadId }) });

describe("Read later", () => {
  it("adds conversations, lists them newest first in the Read later folder, and removes them", async () => {
    expect((await add(c, "t-canary")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect((await add(c, "t-invoice")).status).toBe(200);
    expect((await add(c, "t-invoice")).status).toBe(200); // idempotent

    const items = await c.json<{ items: Item[] }>("/api/mail/read-later");
    expect(items.body.items.map((i) => i.threadId)).toEqual(["t-invoice", "t-canary"]);

    const page = await c.json<Page>("/api/mail/threads?folder=later");
    expect(page.status).toBe(200);
    expect(page.body.threads.map((t) => t.id)).toEqual(["t-invoice", "t-canary"]);
    expect(page.body.threads[1]!.subject).toMatch(/Q4 design review/);

    const del = await c.json<{ removed: boolean }>(`/api/mail/read-later/${accountId}/t-invoice`, { method: "DELETE" });
    expect(del.body.removed).toBe(true);
    expect((await c.json<Page>("/api/mail/threads?folder=later")).body.threads.map((t) => t.id)).toEqual(["t-canary"]);
    // Saving for later doesn't change anything in Gmail.
    const labels = new Set([...h.google.mailbox(ME).messages.values()].filter((m) => m.threadId === "t-canary").flatMap((m) => [...m.labelIds]));
    expect(labels.has("INBOX")).toBe(true);
  });

  it("pages through the list", async () => {
    for (const t of ["t-team", "t-flight", "t-school", "t-landlord", "t-news"]) expect((await add(c, t)).status).toBe(200);
    const first = await c.json<Page>("/api/mail/threads?folder=later&limit=5");
    expect(first.body.threads).toHaveLength(5);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await c.json<Page>(`/api/mail/threads?folder=later&limit=5&cursor=${first.body.nextCursor}`);
    expect(second.body.threads.map((t) => t.id)).toEqual(["t-canary"]);
    expect(second.body.nextCursor).toBeNull();
    expect((await c.json("/api/mail/threads?folder=later&cursor=bm9wZQ")).status).toBe(400);
  });

  it("drops conversations that were deleted in Gmail and hides trashed ones", async () => {
    const box = h.google.mailbox(ME);
    for (const m of [...box.messages.values()].filter((x) => x.threadId === "t-news")) box.messages.delete(m.id);
    await c.json(`/api/mail/threads/${accountId}/t-flight/action`, { method: "POST", body: JSON.stringify({ action: "trash" }) });
    const page = await c.json<Page>("/api/mail/threads?folder=later&limit=50");
    expect(page.body.threads.map((t) => t.id)).not.toContain("t-news");
    expect(page.body.threads.map((t) => t.id)).not.toContain("t-flight");
    const items = (await c.json<{ items: Item[] }>("/api/mail/read-later")).body.items.map((i) => i.threadId);
    expect(items).not.toContain("t-news");
    expect(items).toContain("t-flight"); // comes back if restored
  });

  it("stores only ids", async () => {
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'read_later' ORDER BY column_name`;
    await sql.end();
    expect(cols.map((r) => r.column_name)).toEqual(["account_id", "created_at", "id", "thread_id", "user_id"]);
  });

  it("validates input and that the thread exists", async () => {
    expect((await add(c, "does-not-exist")).status).toBe(404);
    expect((await add(c, "bad id!")).status).toBe(400);
    expect((await c.json("/api/mail/read-later", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-team", note: "x" }) })).status).toBe(400);
    expect((await new Client(h).json("/api/mail/read-later")).status).toBe(401);
  });

  it("isolates lists per user", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "9009", email: "peggy@fluent.test", name: "Peggy" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json<{ items: Item[] }>("/api/mail/read-later")).body.items).toEqual([]);
    expect((await other.json<Page>("/api/mail/threads?folder=later")).body.threads).toEqual([]);
    expect((await add(other, "t-canary")).status).toBe(404); // someone else's account id
    expect((await other.json(`/api/mail/read-later/${accountId}/t-canary`, { method: "DELETE" })).status).toBe(404);
    expect((await c.json<{ items: Item[] }>("/api/mail/read-later")).body.items.map((i) => i.threadId)).toContain("t-canary");
  });

  it("appears in the privacy data summary and export", async () => {
    const d = await c.json<{ stored: Array<{ key: string; count: number }> }>("/api/privacy/data");
    expect(d.body.stored.find((s) => s.key === "read_later")?.count).toBeGreaterThan(0);
    const ex = await c.json<{ readLater: Item[] }>("/api/privacy/export");
    expect(ex.body.readLater.map((i) => i.threadId)).toContain("t-canary");
  });
});
