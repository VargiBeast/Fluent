import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Client, startHarness, TEST_DB_URL, type Harness } from "./harness.js";

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

describe("Settings", () => {
  it("returns defaults, merges partial patches and tracks onboarding", async () => {
    const g = await c.json<{ settings: { appearance: { theme: string; density: string }; ai: { enabled: boolean } }; onboarded: boolean }>("/api/settings");
    expect(g.body.settings.ai.enabled).toBe(true);
    expect(g.body.onboarded).toBe(false);
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ appearance: { density: "compact" }, onboarded: true }) });
    const after = await c.json<{ settings: { appearance: { theme: string; density: string } }; onboarded: boolean }>("/api/settings");
    expect(after.body.settings.appearance.density).toBe("compact");
    expect(after.body.settings.appearance.theme).toBe(g.body.settings.appearance.theme);
    expect(after.body.onboarded).toBe(true);
  });

  it("rejects invalid settings and unknown keys", async () => {
    expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ appearance: { theme: "neon" } }) })).status).toBe(400);
    expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ isAdmin: true }) })).status).toBe(400);
  });

  it("saves the accent colour and focus mode per user, and bounds the focus period", async () => {
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ appearance: { accent: "teal" }, focus: { until } }) })).status).toBe(200);
    const g = await c.json<{ settings: { appearance: { accent: string; theme: string }; focus: { until: string | null } } }>("/api/settings");
    expect(g.body.settings.appearance.accent).toBe("teal");
    expect(Date.parse(g.body.settings.focus.until!)).toBe(Date.parse(until));
    // Another user sees their own defaults.
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "7118", email: "fay@fluent.test", name: "Fay" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    const o = await other.json<{ settings: { appearance: { accent: string }; focus: { until: string | null } } }>("/api/settings");
    expect(o.body.settings.appearance.accent).toBe("purple");
    expect(o.body.settings.focus.until).toBeNull();
    for (const bad of [{ appearance: { accent: "neon" } }, { focus: { until: new Date(Date.now() + 3 * 86400_000).toISOString() } }, { focus: { until: "2000-01-01T00:00:00Z" } }, { focus: { until: "soon" } }, { focus: { until: null, extra: 1 } }]) {
      expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify(bad) })).status).toBe(400);
    }
    expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ focus: { until: null } }) })).status).toBe(200);
    expect((await c.json<{ settings: { focus: { until: string | null } } }>("/api/settings")).body.settings.focus.until).toBeNull();
  });

  it("lists sessions and revokes other sessions", async () => {
    const second = new Client(h);
    await second.login();
    const s = await c.json<{ sessions: Array<{ current: boolean }> }>("/api/security/sessions");
    expect(s.body.sessions.length).toBe(2);
    expect(s.body.sessions.filter((x) => x.current)).toHaveLength(1);
    const r = await c.json<{ revoked: number }>("/api/security/sessions/revoke-others", { method: "POST" });
    expect(r.body.revoked).toBe(1);
    expect((await second.json("/api/mail/threads")).status).toBe(401);
    const ev = await c.json<{ events: Array<{ type: string }> }>("/api/security/events");
    expect(ev.body.events.map((e) => e.type)).toContain("sessions_revoked");
  });

  it("saves general, shortcut, brief and focus preferences and validates them", async () => {
    const ok = { general: { language: "nb-NO", timeZone: "Europe/Oslo", defaultView: "overview" }, shortcuts: { enabled: false }, ai: { dailyBrief: false, briefHour: 7 }, focus: { defaultChoice: "1h", muteToasts: false } };
    expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify(ok) })).status).toBe(200);
    const g = await c.json<{ settings: typeof ok & { focus: { until: string | null } } }>("/api/settings");
    expect(g.body.settings.general).toEqual(ok.general);
    expect(g.body.settings.shortcuts.enabled).toBe(false);
    expect(g.body.settings.ai).toMatchObject(ok.ai);
    expect(g.body.settings.focus).toMatchObject(ok.focus);
    // The brief is off, so it is neither generated nor served.
    expect((await c.json("/api/ai/brief")).status).toBe(403);
    for (const bad of [{ general: { timeZone: "Mars/Olympus" } }, { general: { language: "not a language!" } }, { general: { defaultView: "spam" } }, { ai: { briefHour: 24 } }, { focus: { defaultChoice: "forever" } }, { shortcuts: { enabled: "no" } }]) {
      expect((await c.json("/api/settings", { method: "PATCH", body: JSON.stringify(bad) })).status).toBe(400);
    }
    await c.json("/api/settings", { method: "PATCH", body: JSON.stringify({ general: { language: "auto", timeZone: "auto", defaultView: "inbox" }, shortcuts: { enabled: true }, ai: { dailyBrief: true, briefHour: 0 }, focus: { defaultChoice: "30m", muteToasts: true } }) });
  });

  it("records the last successful Gmail sync per account", async () => {
    await c.json("/api/mail/sync");
    await c.json("/api/mail/sync");
    const s = await c.json<{ accounts: Array<{ lastSyncedAt: string | null }> }>("/api/auth/session");
    expect(Date.now() - Date.parse(s.body.accounts[0]!.lastSyncedAt ?? "")).toBeLessThan(60_000);
  });

  it("signs out everywhere, this session included", async () => {
    const a = new Client(h);
    await a.login();
    const b = new Client(h);
    await b.login();
    const r = await a.json<{ revoked: number }>("/api/security/sessions/revoke-all", { method: "POST" });
    expect(r.body.revoked).toBeGreaterThanOrEqual(2);
    expect((await a.json("/api/mail/threads")).status).toBe(401);
    expect((await b.json("/api/mail/threads")).status).toBe(401);
    await c.login();
  });

  it("does not let another user touch this user's accounts or privacy data", async () => {
    await fetch(`${h.google.url}/__control/identity`, { method: "POST", body: JSON.stringify({ sub: "3003", email: "eve@fluent.test", name: "Eve" }) });
    const other = new Client(h);
    await other.login();
    await fetch(`${h.google.url}/__control/reset`, { method: "POST" });
    expect((await other.json(`/api/accounts/${accountId}`, { method: "DELETE" })).status).toBe(404);
    const audit = await other.json<{ entries: unknown[] }>("/api/privacy/audit");
    expect(audit.body.entries).toHaveLength(0);
    const exp = await (await other.raw("/api/privacy/export")).text();
    expect(exp).not.toContain("alex@fluent.test");
  });

  it("deleting all data requires typed confirmation, revokes Google tokens and removes every row", async () => {
    expect((await c.json("/api/me", { method: "DELETE", body: JSON.stringify({}) })).status).toBe(400);
    const before = h.google.state.revoked.length;
    expect((await c.json("/api/me", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) })).status).toBe(400);
    expect((await c.json("/api/me", { method: "DELETE", body: JSON.stringify({ confirm: "delete my account" }) })).status).toBe(400);
    const r = await c.json<{ ok: boolean }>("/api/me", { method: "DELETE", body: JSON.stringify({ confirm: "Delete my account" }) });
    expect(r.status).toBe(200);
    expect(h.google.state.revoked.length).toBeGreaterThan(before);
    expect((await c.json("/api/mail/threads")).status).toBe(401);
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    const rows = await sql`select count(*)::int as n from accounts where email = 'alex@fluent.test'`;
    const users = await sql`select count(*)::int as n from users where email = 'alex@fluent.test'`;
    await sql.end();
    expect(rows[0]!.n).toBe(0);
    expect(users[0]!.n).toBe(0);
  });
});

describe("Disconnect account", () => {
  it("revokes at Google and removes the account", async () => {
    const d = new Client(h);
    await d.login();
    const s = await d.json<{ accounts: Array<{ id: string }> }>("/api/auth/session");
    const id = s.body.accounts[0]!.id;
    const r = await d.json<{ ok: boolean; revokedAtGoogle: boolean }>(`/api/accounts/${id}`, { method: "DELETE" });
    expect(r.body).toEqual({ ok: true, revokedAtGoogle: true });
    const after = await d.json<{ accounts: unknown[] }>("/api/accounts");
    expect(after.body.accounts).toHaveLength(0);
  });
});
