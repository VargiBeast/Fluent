import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { startHarness, TEST_DB_URL, type Harness } from "./harness.js";
import { resetEnv } from "../../server/env.js";
import { resetDeepCheckCache } from "../../server/lib/readiness.js";

let h: Harness;
let ip = 0;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(() => { resetDeepCheckCache(); ip++; });

const ready = (q = "?deep=1", addr = `203.0.113.${ip}`) =>
  h.app.request(`http://localhost:5173/api/ready${q}`, { headers: { "x-forwarded-for": addr } });

describe("GET /api/ready?deep=1", () => {
  it("verifies AI and the Google client without echoing model output", async () => {
    const before = h.google.state.aiRequests.length;
    const res = await ready();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, database: "ok", ai: "ok", googleClient: "ok", cached: false });
    expect(JSON.stringify(body)).not.toContain("OK\"");
    expect(h.google.state.aiRequests.length).toBe(before + 1);
    expect(JSON.stringify(h.google.state.aiRequests.at(-1)!.body)).not.toMatch(/email|<email/i);
  });

  it("caches deep results for a minute so callers can't fan out to providers", async () => {
    await ready();
    const n = h.google.state.aiRequests.length;
    const again = await (await ready("?deep=1", "203.0.113.250")).json();
    expect(again.cached).toBe(true);
    expect(h.google.state.aiRequests.length).toBe(n);
  });

  it("reports a wrong Google client secret as invalid_client and an AI failure as error", async () => {
    process.env.GOOGLE_CLIENT_SECRET = "wrong-secret";
    h.google.state.aiFail = true;
    resetEnv();
    try {
      const res = await ready();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, ai: "error", googleClient: "invalid_client" });
    } finally {
      process.env.GOOGLE_CLIENT_SECRET = h.google.state.clientSecret;
      h.google.state.aiFail = false;
      resetEnv();
    }
  });

  it("reports not_configured when keys are missing", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
    resetEnv();
    try {
      expect(await (await ready()).json()).toMatchObject({ ok: false, ai: "not_configured", googleClient: "ok" });
    } finally {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "fake-gemini-key";
      resetEnv();
    }
  });

  it("rate limits deep checks per IP (5 per 10 minutes) while the shallow check stays open", async () => {
    const addr = "198.51.100.7";
    for (let i = 0; i < 5; i++) expect((await ready("?deep=1", addr)).status).not.toBe(429);
    const limited = await ready("?deep=1", addr);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect((await ready("", addr)).status).toBe(200);
  });

  it("enforces a global cap of 30 deep checks per hour", async () => {
    const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
    await sql`update rate_limits set count = 1000 where key = 'ready_deep:global'`;
    await sql.end();
    expect((await ready("?deep=1", "192.0.2.99")).status).toBe(429);
    const sql2 = postgres(TEST_DB_URL, { onnotice: () => {} });
    await sql2`delete from rate_limits where key = 'ready_deep:global'`;
    await sql2.end();
  });
});
