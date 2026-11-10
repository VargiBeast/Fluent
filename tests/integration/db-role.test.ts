import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { resetEnv } from "../../server/env.js";
import { closeDb } from "../../server/db/client.js";
import { createApp } from "../../server/app.js";

const appPw = randomBytes(18).toString("hex");
const probePw = randomBytes(18).toString("hex");
const asRole = (role: string, pw: string) => {
  const u = new URL(TEST_DB_URL);
  u.username = role;
  u.password = pw;
  return u.toString();
};

let h: Harness;
beforeAll(async () => {
  const admin = postgres(TEST_DB_URL, { onnotice: () => {} });
  for (const [r, pw] of [["fluent_app", appPw], ["fluent_probe", probePw]] as const) {
    await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${r}') THEN CREATE ROLE ${r} LOGIN; END IF; END $$;`);
    await admin.unsafe(`ALTER ROLE ${r} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${pw}'`);
  }
  await admin.end();
  h = await startHarness(); // runs migrations, including 0002 which grants fluent_app
});
afterAll(async () => {
  await h.close();
  const admin = postgres(TEST_DB_URL, { onnotice: () => {} });
  await admin.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await admin.unsafe("DROP ROLE IF EXISTS fluent_app; DROP ROLE IF EXISTS fluent_probe;");
  await admin.end();
});

describe("Readiness and least-privilege DB role", () => {
  it("reports ready against the owner connection", async () => {
    const res = await h.app.request("http://localhost:5173/api/ready");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, database: "ok" });
  });

  it("runs the full sign-in flow as the restricted fluent_app role", async () => {
    process.env.DATABASE_URL = asRole("fluent_app", appPw);
    resetEnv();
    await closeDb();
    const app = createApp();
    expect((await app.request("http://localhost:5173/api/ready")).status).toBe(200);
    const c = new Client({ ...h, app });
    await c.login();
    const s = await c.json<{ user: { email: string } | null }>("/api/auth/session");
    expect(s.status).toBe(200);
    expect(s.body.user).toBeTruthy();
    // Tables added after 0002 carry their own grants + policy for fluent_app.
    const tpl = await c.json<{ id: string }>("/api/templates", { method: "POST", body: JSON.stringify({ name: "Role check", body: "ok" }) });
    expect(tpl.status).toBe(201);
    expect((await c.json(`/api/templates/${tpl.body.id}`, { method: "DELETE" })).status).toBe(200);
    const accountId = (await c.json<{ accounts: Array<{ id: string }> }>("/api/auth/session")).body.accounts[0]!.id;
    expect((await c.json("/api/mail/read-later", { method: "POST", body: JSON.stringify({ accountId, threadId: "t-canary" }) })).status).toBe(200);
    expect((await c.json<{ threads: unknown[] }>("/api/mail/threads?folder=later")).body.threads).toHaveLength(1);
  });

  it("keeps other roles out and reports not-ready without leaking details", async () => {
    // Mirror a hosted default where every role can see the public schema.
    const admin = postgres(TEST_DB_URL, { onnotice: () => {} });
    await admin.unsafe("GRANT USAGE ON SCHEMA public TO PUBLIC");
    await admin.end();
    const probe = postgres(asRole("fluent_probe", probePw), { onnotice: () => {} });
    await expect(probe`select * from users`).rejects.toThrow(/permission denied/);
    await probe.end();
    process.env.DATABASE_URL = asRole("fluent_probe", probePw);
    resetEnv();
    await closeDb();
    const res = await createApp().request("http://localhost:5173/api/ready");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, database: "error" });
    await closeDb();
  });
});
