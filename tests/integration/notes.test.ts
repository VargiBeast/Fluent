import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

let h: Harness;
let c: Client;
let accountId: string;

interface Note { accountId: string; threadId: string; body: string; createdAt: string; updatedAt: string }

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
  accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
});
afterAll(async () => { await h.close(); });

const path = (threadId: string, acc = accountId) => `/api/notes/${acc}/${threadId}`;
const put = (cl: Client, threadId: string, body: unknown, acc = accountId) => cl.json<{ note: Note }>(path(threadId, acc), { method: "PUT", body: JSON.stringify(body) });

describe("Private notes", () => {
  it("creates, reads, updates and deletes a note on a conversation", async () => {
    expect((await c.json<{ note: Note | null }>(path("t-canary"))).body.note).toBeNull();
    const created = await put(c, "t-canary", { body: "Call Ola back\nabout the Q4 budget" });
    expect(created.status).toBe(200);
    expect(created.body.note.body).toBe("Call Ola back\nabout the Q4 budget");
    const updated = await put(c, "t-canary", { body: "Called. Waiting on numbers." });
    expect(updated.body.note.body).toBe("Called. Waiting on numbers.");
    expect(updated.body.note.createdAt).toBe(created.body.note.createdAt);
    expect((await c.json<{ note: Note | null }>(path("t-canary"))).body.note?.body).toBe("Called. Waiting on numbers.");
    const del = await c.json<{ removed: boolean }>(path("t-canary"), { method: "DELETE" });
    expect(del.body.removed).toBe(true);
    expect((await c.json<{ note: Note | null }>(path("t-canary"))).body.note).toBeNull();
  });

  it("encrypts the text at rest and never touches Gmail", async () => {
    const before = JSON.stringify([...h.google.mailbox("alex@fluent.test").messages.values()].filter((m) => m.threadId === "t-invoice"));
    await put(c, "t-invoice", { body: "secret-note-marker pay by Friday" });
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const rows = await sql`SELECT * FROM thread_notes WHERE thread_id = 't-invoice'`;
    await sql.end();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("secret-note-marker");
    expect(String(rows[0]!.body_enc).length).toBeGreaterThan(20);
    expect(JSON.stringify([...h.google.mailbox("alex@fluent.test").messages.values()].filter((m) => m.threadId === "t-invoice"))).toBe(before);
  });

  it("validates input and that the thread exists", async () => {
    expect((await put(c, "does-not-exist", { body: "x" })).status).toBe(404);
    expect((await put(c, "bad id!", { body: "x" })).status).toBe(400);
    expect((await put(c, "t-team", { body: "   " })).status).toBe(400);
    expect((await put(c, "t-team", { body: "x".repeat(5001) })).status).toBe(400);
    expect((await put(c, "t-team", { body: "ok", extra: 1 })).status).toBe(400);
    expect((await put(c, "t-team", { body: "bad\u0000char" })).status).toBe(400);
    expect((await c.json("/api/notes/not-a-uuid/t-team")).status).toBe(400);
    expect((await new Client(h).json(path("t-team"))).status).toBe(401);
  });

  it("isolates notes per user", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "7117", email: "eve@fluent.test", name: "Eve" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json(path("t-invoice"))).status).toBe(404); // someone else's account
    expect((await put(other, "t-invoice", { body: "pwn" })).status).toBe(404);
    expect((await other.json(path("t-invoice"), { method: "DELETE" })).status).toBe(404);
    const ex = await other.json<{ notes: Note[] }>("/api/privacy/export");
    expect(ex.body.notes).toEqual([]);
    expect((await c.json<{ note: Note | null }>(path("t-invoice"))).body.note?.body).toBe("secret-note-marker pay by Friday");
  });

  it("appears in the privacy data summary and export", async () => {
    const d = await c.json<{ stored: Array<{ key: string; count: number }> }>("/api/privacy/data");
    expect(d.body.stored.find((s) => s.key === "notes")?.count).toBe(1);
    const ex = await c.json<{ notes: Note[] }>("/api/privacy/export");
    expect(ex.body.notes.map((n) => [n.threadId, n.body])).toEqual([["t-invoice", "secret-note-marker pay by Friday"]]);
  });

  it("deletes notes when the account is disconnected (cascade)", async () => {
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const fk = await sql`SELECT confdeltype FROM pg_constraint WHERE conname = 'thread_notes_account_id_accounts_id_fk'`;
    await sql.end();
    expect(fk[0]?.confdeltype).toBe("c");
  });
});
