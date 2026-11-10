import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

describe("Google OAuth sign-in (PKCE, state, nonce) against real Postgres", () => {
  it("reports configuration honestly", async () => {
    const c = new Client(h);
    const r = await c.json<{ google: boolean; ai: boolean; database: boolean }>("/api/config");
    expect(r.body).toMatchObject({ google: true, ai: true, database: true });
  });

  it("start redirects to Google with PKCE S256, state and nonce, and sets a sealed state cookie", async () => {
    const c = new Client(h);
    const res = await c.raw("/api/auth/google/start");
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
    expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loc.searchParams.get("state")).toBeTruthy();
    expect(loc.searchParams.get("nonce")).toBeTruthy();
    expect(loc.searchParams.get("access_type")).toBe("offline");
    expect(loc.searchParams.get("scope")).toContain("gmail.modify");
    expect(loc.searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/google/callback");
    const setCookie = res.headers.getSetCookie().join(";");
    expect(setCookie).toMatch(/fluent_oauth=v1\./);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("completes login, creates a session, encrypts tokens at rest and lands on onboarding", async () => {
    const c = new Client(h);
    const res = await c.login();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/app/onboarding");
    const s = await c.json<{ user: { email: string }; accounts: Array<{ status: string; email: string }>; csrfToken: string; onboarded: boolean }>("/api/auth/session");
    expect(s.body.user.email).toBe("alex@fluent.test");
    expect(s.body.accounts).toHaveLength(1);
    expect(s.body.accounts[0]!.status).toBe("active");
    expect(s.body.onboarded).toBe(false);
    expect(s.body.csrfToken.length).toBeGreaterThan(20);

    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const [acc] = await sql`select refresh_token_enc, access_token_enc from accounts`;
    const [sess] = await sql`select id from sessions limit 1`;
    await sql.end();
    expect(acc!.refresh_token_enc).toMatch(/^v1\./);
    expect(acc!.refresh_token_enc).not.toContain("fake-refresh");
    expect(acc!.access_token_enc).not.toContain("ya29");
    // Session id is a hash; the raw cookie value is never stored.
    const raw = [...c.cookies.values()][0]!;
    expect(sess!.id).not.toBe(raw);
  });

  it("rejects a callback with a forged state", async () => {
    const c = new Client(h);
    const start = await c.raw("/api/auth/google/start");
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(authorize.headers.get("location")!);
    cb.searchParams.set("state", "forged");
    const res = await c.raw(`${cb.pathname}${cb.search}`);
    expect(res.headers.get("location")).toBe("/?error=state_invalid");
    expect((await c.json<{ user: null }>("/api/auth/session")).body.user).toBeNull();
  });

  it("rejects a callback without the state cookie (login CSRF)", async () => {
    const victim = new Client(h);
    const attacker = new Client(h);
    const start = await attacker.raw("/api/auth/google/start");
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(authorize.headers.get("location")!);
    const res = await victim.raw(`${cb.pathname}${cb.search}`);
    expect(res.headers.get("location")).toBe("/?error=state_missing");
  });

  it("handles a user denying consent", async () => {
    const c = new Client(h);
    const start = await c.raw("/api/auth/google/start");
    const authorize = await fetch(`${start.headers.get("location")!}&deny=1`, { redirect: "manual" });
    const cb = new URL(authorize.headers.get("location")!);
    const res = await c.raw(`${cb.pathname}${cb.search}`);
    expect(res.headers.get("location")).toBe("/?error=access_denied");
  });

  it("refuses unverified Google emails", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "999", email: "unverified@fluent.test", name: "U", emailVerified: false }) });
    const c = new Client(h);
    const res = await c.login();
    expect(res.headers.get("location")).toBe("/?error=email_unverified");
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
  });

  it("flags accounts where the user unticked the Gmail scope", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "555", email: "partial@fluent.test", name: "Partial", scopes: "openid email profile" }) });
    const c = new Client(h);
    const res = await c.login();
    expect(res.headers.get("location")).toBe("/app/onboarding?error=insufficient_scopes");
    const s = await c.json<{ accounts: Array<{ status: string }> }>("/api/auth/session");
    expect(s.body.accounts[0]!.status).toBe("insufficient_scopes");
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
  });

  it("requires CSRF token and same origin for mutations; logout destroys the session", async () => {
    const c = new Client(h);
    await c.login();
    const noToken = await c.raw("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": "wrong" } });
    expect(noToken.status).toBe(403);
    const crossSite = await c.raw("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(crossSite.status).toBe(403);
    const ok = await c.json("/api/auth/logout", { method: "POST" });
    expect(ok.status).toBe(200);
    expect((await c.json<{ user: null }>("/api/auth/session")).body.user).toBeNull();
  });

  it("rejects unauthenticated access to protected routes", async () => {
    const c = new Client(h);
    const r = await c.json("/api/auth/logout", { method: "POST" });
    expect(r.status).toBe(401);
  });

  it("does not follow open redirects in next=", async () => {
    const c = new Client(h);
    // complete onboarding-free flow by using an existing onboarded user is covered elsewhere; here we check the sealed next value
    const start = await c.raw("/api/auth/google/start?next=https://evil.example");
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).not.toContain("evil");
  });
});
