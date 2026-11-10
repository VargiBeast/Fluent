import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { startFakeMicrosoft, type FakeMicrosoft } from "../fakes/microsoft.js";
import { resetEnv } from "../../server/env.js";

let h: Harness;
let ms: FakeMicrosoft;
let c: Client;
const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
const configure = (on: boolean) => {
  Object.assign(process.env, on
    ? { MS_CLIENT_ID: ms.state.clientId, MS_CLIENT_SECRET: ms.state.clientSecret, FLUENT_TEST_MS_BASE: ms.url }
    : { MS_CLIENT_ID: "", MS_CLIENT_SECRET: "", FLUENT_TEST_MS_BASE: "" });
  if (!on) for (const k of ["MS_CLIENT_ID", "MS_CLIENT_SECRET", "FLUENT_TEST_MS_BASE"]) delete process.env[k];
  resetEnv();
};

/** FLUENT start -> fake Microsoft authorize -> FLUENT callback. Returns the final redirect. */
async function connect(client: Client, tamper?: (u: URL) => void): Promise<string> {
  const start = await client.raw("/api/auth/microsoft/start");
  expect(start.status).toBe(302);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const cb = new URL(authorize.headers.get("location")!);
  tamper?.(cb);
  const res = await client.raw(`${cb.pathname}${cb.search}`);
  return res.headers.get("location") ?? "";
}

beforeAll(async () => {
  ms = await startFakeMicrosoft();
  h = await startHarness();
  c = new Client(h);
  await c.login();
});
afterAll(async () => {
  configure(false);
  await sql.end();
  await h.close();
  await ms.close();
});

describe("Microsoft OAuth (Outlook / Microsoft 365)", () => {
  it("reports 'not configured' and refuses to start until MS_CLIENT_ID/MS_CLIENT_SECRET are set", async () => {
    configure(false);
    expect((await c.json<{ microsoft: boolean }>("/api/config")).body.microsoft).toBe(false);
    const r = await c.raw("/api/auth/microsoft/start");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/app/account?error=outlook_not_configured");
    expect(r.headers.getSetCookie().join()).not.toContain("fluent_oauth_ms");
  });

  it("needs a FLUENT session", async () => {
    configure(true);
    const anon = new Client(h);
    expect((await anon.raw("/api/auth/microsoft/start")).headers.get("location")).toBe("/?error=session_required");
  });

  it("starts with PKCE (S256), state, the common authority and exactly the four delegated scopes", async () => {
    configure(true);
    expect((await c.json<{ microsoft: boolean }>("/api/config")).body.microsoft).toBe(true);
    const r = await c.raw("/api/auth/microsoft/start");
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(`${ms.url}/common/oauth2/v2.0/authorize`);
    const p = loc.searchParams;
    expect(p.get("client_id")).toBe(ms.state.clientId);
    expect(p.get("redirect_uri")).toBe("http://localhost:5173/api/auth/microsoft/callback");
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(p.get("state")!.length).toBeGreaterThanOrEqual(24);
    expect(p.get("scope")!.split(" ").sort()).toEqual(["Mail.ReadWrite", "Mail.Send", "User.Read", "offline_access"]);
    const cookie = r.headers.getSetCookie().find((x) => x.startsWith("fluent_oauth_ms="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
    expect(cookie).not.toContain(p.get("state")!); // sealed, not readable
  });

  it("rejects a missing cookie, a wrong state and a callback from another session", async () => {
    configure(true);
    const fresh = new Client(h);
    await fresh.login();
    expect((await fresh.raw("/api/auth/microsoft/callback?code=x&state=y")).headers.get("location")).toBe("/app/account?error=state_missing");
    expect(await connect(fresh, (u) => u.searchParams.set("state", "forged-state-value-000000"))).toBe("/app/account?error=state_invalid");
    // Login CSRF: someone else's callback URL can't attach their mailbox to this user's session.
    const start = await fresh.raw("/api/auth/microsoft/start");
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(authorize.headers.get("location")!);
    const victim = new Client(h);
    await victim.login();
    expect((await victim.raw(`${cb.pathname}${cb.search}`)).headers.get("location")).toBe("/app/account?error=state_missing");
    const denied = await connect(fresh, (u) => { u.searchParams.delete("code"); u.searchParams.set("error", "access_denied"); });
    expect(denied).toBe("/app/account?error=access_denied");
  });

  it("fails when the PKCE verifier doesn't match", async () => {
    configure(true);
    const start = await c.raw("/api/auth/microsoft/start");
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(authorize.headers.get("location")!);
    // A second start replaces the cookie (new verifier); the old code no longer matches it.
    const again = await c.raw("/api/auth/microsoft/start");
    const st = new URL(again.headers.get("location")!).searchParams.get("state")!;
    cb.searchParams.set("state", st);
    expect((await c.raw(`${cb.pathname}${cb.search}`)).headers.get("location")).toBe("/app/account?error=invalid_grant");
  });

  it("connects the mailbox with encrypted tokens, as an Outlook account of this user", async () => {
    configure(true);
    expect(await connect(c)).toBe("/app/account?connected=outlook");
    const rows = await sql`select provider, email, google_sub, status, access_token_enc, refresh_token_enc from accounts where provider = 'outlook'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "outlook", email: "alex@outlook.example", google_sub: `ms:${ms.state.profile.id}`, status: "active" });
    for (const t of ms.state.tokens.keys()) expect(String(rows[0]!.access_token_enc)).not.toContain(t);
    expect(String(rows[0]!.refresh_token_enc)).not.toMatch(/^rt-/);
    const s = await c.json<{ accounts: Array<{ provider: string; email: string }> }>("/api/auth/session");
    expect(s.body.accounts).toContainEqual(expect.objectContaining({ provider: "outlook", email: "alex@outlook.example" }));
    expect(JSON.stringify(s.body)).not.toContain("_enc");
  });

  it("flags missing mail permissions or offline access instead of a working account", async () => {
    configure(true);
    ms.state.grantScope = "User.Read offline_access";
    expect(await connect(c)).toBe("/app/account?error=insufficient_scopes");
    ms.state.grantScope = "Mail.ReadWrite Mail.Send User.Read";
    ms.state.issueRefreshToken = false;
    expect(await connect(c)).toBe("/app/account?error=offline_access_missing");
    ms.state.issueRefreshToken = true;
    ms.state.grantScope = "Mail.ReadWrite Mail.Send User.Read offline_access";
  });
});
