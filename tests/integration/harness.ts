import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { startFakeGoogle, type FakeGoogle } from "../fakes/google.js";
import { resetEnv } from "../../server/env.js";
import { closeDb } from "../../server/db/client.js";
import { runMigrations } from "../../server/db/migrate.js";
import { createApp } from "../../server/app.js";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:pw@127.0.0.1:54329/fluent_test";
export const APP_URL = "http://localhost:5173";

export interface Harness {
  app: ReturnType<typeof createApp>;
  google: FakeGoogle;
  close(): Promise<void>;
}

/** Boot the real API against a real Postgres and the HTTP-level Google/xAI fake. */
export async function startHarness(opts: { ai?: boolean } = {}): Promise<Harness> {
  const google = await startFakeGoogle();
  Object.assign(process.env, {
    NODE_ENV: "test",
    APP_URL,
    DATABASE_URL: TEST_DB_URL,
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    GOOGLE_CLIENT_ID: google.state.clientId,
    GOOGLE_CLIENT_SECRET: google.state.clientSecret,
    FLUENT_TEST_GOOGLE_BASE: google.url,
    FLUENT_TEST_AI_BASE: `${google.url}/v1`,
    AI_PROVIDER: "xai",
    XAI_API_KEY: opts.ai === false ? "" : "fake-xai-key",
  });
  resetEnv();
  await closeDb();
  const sql = postgres(TEST_DB_URL, { onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await sql.end();
  await runMigrations();
  return {
    app: createApp(),
    google,
    async close() {
      await closeDb();
      await google.close();
    },
  };
}

/** Tiny cookie-jar client that drives the Hono app in-process with real Request objects. */
export class Client {
  cookies = new Map<string, string>();
  csrf = "";
  constructor(private h: Harness) {}

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private store(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [k, ...v] = pair!.split("=");
      const val = v.join("=");
      if (attrs.some((a) => /max-age=0/i.test(a)) || val === "") this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), val);
    }
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set("cookie", this.cookieHeader());
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET" && !headers.has("origin")) headers.set("origin", APP_URL);
    if (method !== "GET" && this.csrf && !headers.has("x-csrf-token")) headers.set("x-csrf-token", this.csrf);
    if (init.body && typeof init.body === "string" && !headers.has("content-type")) headers.set("content-type", "application/json");
    const res = await this.h.app.request(`${APP_URL}${path}`, { ...init, headers, redirect: "manual" });
    this.store(res);
    return res;
  }

  async json<T = unknown>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
    const res = await this.raw(path, init);
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  }

  /** Full Google OAuth round-trip: FLUENT -> fake Google authorize -> FLUENT callback. */
  async login(mode: "login" | "link" = "login", extra = ""): Promise<Response> {
    const start = await this.raw(`/api/auth/google/start?mode=${mode}${extra}`);
    if (start.status !== 302) return start;
    const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(authorize.headers.get("location")!);
    const res = await this.raw(`${cb.pathname}${cb.search}`);
    const s = await this.json<{ csrfToken?: string }>("/api/auth/session");
    this.csrf = s.body.csrfToken ?? "";
    return res;
  }
}
