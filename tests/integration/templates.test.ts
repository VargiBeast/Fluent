import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

let h: Harness;
let c: Client;

interface Tpl { id: string; name: string; subject: string; body: string }

beforeAll(async () => {
  h = await startHarness();
  c = new Client(h);
  await c.login();
});
afterAll(async () => { await h.close(); });

const post = (cl: Client, body: unknown) => cl.json<Tpl>("/api/templates", { method: "POST", body: JSON.stringify(body) });

describe("Templates (saved replies)", () => {
  it("creates, lists (sorted by name), updates and deletes templates", async () => {
    const a = await post(c, { name: "Thanks", body: "Thanks so much!\n\nBest" });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: "Thanks", subject: "", body: "Thanks so much!\n\nBest" });
    const b = await post(c, { name: "availability", subject: "Times next week", body: "I'm free Tuesday or Wednesday." });
    expect(b.status).toBe(201);

    const list = await c.json<{ templates: Tpl[] }>("/api/templates");
    expect(list.body.templates.map((t) => t.name)).toEqual(["availability", "Thanks"]);

    const up = await c.json<Tpl>(`/api/templates/${a.body.id}`, { method: "PUT", body: JSON.stringify({ name: "Thank you", subject: "", body: "Thank you!" }) });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ id: a.body.id, name: "Thank you", body: "Thank you!" });

    expect((await c.json(`/api/templates/${b.body.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await c.json(`/api/templates/${b.body.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await c.json<{ templates: Tpl[] }>("/api/templates")).body.templates.map((t) => t.id)).toEqual([a.body.id]);
  });

  it("stores names and bodies encrypted, never in plain text", async () => {
    await post(c, { name: "Secret-ish name", body: "Unique body marker 7f3a" });
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const rows = await sql`SELECT name_enc, subject_enc, body_enc FROM templates`;
    await sql.end();
    expect(rows.length).toBeGreaterThan(0);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("Unique body marker");
    expect(dump).not.toContain("Secret-ish");
  });

  it("validates input strictly", async () => {
    expect((await post(c, { name: "", body: "x" })).status).toBe(400);
    expect((await post(c, { name: "ok", body: "   " })).status).toBe(400);
    expect((await post(c, { name: "a\r\nBcc: evil@x.test", body: "x" })).status).toBe(400);
    expect((await post(c, { name: "ok", subject: "Hi\nBcc: evil@x.test", body: "x" })).status).toBe(400);
    expect((await post(c, { name: "ok", body: "x".repeat(10_001) })).status).toBe(400);
    expect((await post(c, { name: "ok", body: "x", extra: 1 })).status).toBe(400);
    expect((await c.json("/api/templates/not-a-uuid", { method: "DELETE" })).status).toBe(400);
  });

  it("requires sign-in and CSRF", async () => {
    const anon = new Client(h);
    expect((await anon.json("/api/templates")).status).toBe(401);
    const res = await c.raw("/api/templates", { method: "POST", body: JSON.stringify({ name: "x", body: "y" }), headers: { "x-csrf-token": "wrong" } });
    expect(res.status).toBe(403);
  });

  it("isolates templates per user", async () => {
    const mine = (await c.json<{ templates: Tpl[] }>("/api/templates")).body.templates;
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "6006", email: "mallory@fluent.test", name: "Mallory" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json<{ templates: Tpl[] }>("/api/templates")).body.templates).toEqual([]);
    const id = mine[0]!.id;
    expect((await other.json(`/api/templates/${id}`, { method: "PUT", body: JSON.stringify({ name: "pwn", body: "pwn" }) })).status).toBe(404);
    expect((await other.json(`/api/templates/${id}`, { method: "DELETE" })).status).toBe(404);
    expect((await c.json<{ templates: Tpl[] }>("/api/templates")).body.templates.find((t) => t.id === id)?.name).toBe(mine[0]!.name);
  });

  it("appears in the privacy data summary and the export", async () => {
    const d = await c.json<{ stored: Array<{ key: string; count: number }> }>("/api/privacy/data");
    expect(d.body.stored.find((s) => s.key === "templates")?.count).toBeGreaterThan(0);
    const ex = await c.json<{ templates: Array<{ name: string }> }>("/api/privacy/export");
    expect(ex.body.templates.map((t) => t.name)).toContain("Thank you");
  });
});
