import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, startHarness, type Harness } from "./harness.js";

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
const items = (...ids: string[]) => ids.map((threadId) => ({ accountId, threadId }));
const bulk = (body: unknown, client = c) => client.json<{ ok: number; failed: number; undo: { action: string; labelId?: string }; error?: { code: string } }>("/api/mail/bulk", { method: "POST", body: JSON.stringify(body) });

describe("Bulk actions", () => {
  it("archives several conversations with batchModify (every message) and undoes", async () => {
    const r = await bulk({ items: items("t-team", "t-news", "t-forum"), action: "archive" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: 3, failed: 0, undo: { action: "inbox" } });
    for (const t of ["t-team", "t-news", "t-forum"]) expect(labelsOf(t).has("INBOX")).toBe(false);
    const u = await bulk({ items: items("t-team", "t-news", "t-forum"), action: r.body.undo.action });
    expect(u.body.ok).toBe(3);
    for (const t of ["t-team", "t-news", "t-forum"]) expect(labelsOf(t).has("INBOX")).toBe(true);
  });

  it("moves to Trash (never deletes) and restores", async () => {
    const r = await bulk({ items: items("t-social", "t-forum"), action: "trash" });
    expect(r.body).toMatchObject({ ok: 2, undo: { action: "untrash" } });
    expect(labelsOf("t-social").has("TRASH")).toBe(true);
    expect(h.google.mailbox(ME).messages.size).toBeGreaterThan(0);
    await bulk({ items: items("t-social", "t-forum"), action: "untrash" });
    expect(labelsOf("t-social").has("TRASH")).toBe(false);
  });

  it("marks read/unread and labels with a user label only", async () => {
    await bulk({ items: items("t-team", "t-social"), action: "read" });
    expect(labelsOf("t-team").has("UNREAD")).toBe(false);
    const r = await bulk({ items: items("t-flight", "t-news"), action: "label_add", labelId: "Label_3" });
    expect(r.body).toMatchObject({ ok: 2, undo: { action: "label_remove", labelId: "Label_3" } });
    expect(labelsOf("t-news").has("Label_3")).toBe(true);
    expect((await bulk({ items: items("t-news"), action: "label_add", labelId: "TRASH" })).status).toBe(400);
    expect((await bulk({ items: items("t-news"), action: "label_add" })).status).toBe(400);
  });

  it("validates size, ids and actions", async () => {
    expect((await bulk({ items: [], action: "archive" })).status).toBe(400);
    expect((await bulk({ items: Array.from({ length: 101 }, (_, i) => ({ accountId, threadId: `t${i}` })), action: "archive" })).status).toBe(400);
    expect((await bulk({ items: items("../etc"), action: "archive" })).status).toBe(400);
    expect((await bulk({ items: items("t-news"), action: "delete_forever" })).status).toBe(400);
  });

  it("is scoped to the user's own accounts and needs CSRF", async () => {
    const res = await c.raw("/api/mail/bulk", { method: "POST", body: JSON.stringify({ items: items("t-news"), action: "archive" }), headers: { "x-csrf-token": "nope" } });
    expect(res.status).toBe(403);
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "6006", email: "oscar@fluent.test", name: "Oscar" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await bulk({ items: items("t-news"), action: "archive" }, other)).status).toBe(404);
    expect(labelsOf("t-news").has("INBOX")).toBe(true);
  });
});
