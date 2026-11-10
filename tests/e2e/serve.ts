/**
 * E2E server: the real FLUENT API + the built SPA (with the same security headers as vercel.json),
 * wired to the HTTP-level Google/Gmail/xAI fake and a local Postgres. Test-only; never deployed.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import postgres from "postgres";
import { startFakeGoogle } from "../fakes/google.js";

const PORT = Number(process.env.E2E_PORT ?? 4173);
const FAKE_PORT = Number(process.env.E2E_FAKE_PORT ?? 4180);
const DB = process.env.E2E_DATABASE_URL ?? "postgres://postgres:pw@127.0.0.1:54329/fluent_e2e";
const AI = process.env.E2E_AI !== "0";
const GOOGLE = process.env.E2E_GOOGLE !== "0";

const google = await startFakeGoogle({ port: FAKE_PORT });
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: `http://localhost:${PORT}`,
  DATABASE_URL: DB,
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CLIENT_ID: GOOGLE ? google.state.clientId : "",
  GOOGLE_CLIENT_SECRET: GOOGLE ? google.state.clientSecret : "",
  FLUENT_TEST_GOOGLE_BASE: google.url,
  FLUENT_TEST_AI_BASE: `${google.url}/v1`,
  AI_PROVIDER: "xai",
  XAI_API_KEY: AI ? "fake-xai-key" : "",
  LOG_LEVEL: "warn",
});

const admin = postgres(DB.replace(/\/[^/]+$/, "/postgres"), { onnotice: () => {} });
const dbName = DB.split("/").pop()!;
const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
if (!exists.length) await admin.unsafe(`create database "${dbName}"`);
await admin.end();
const sql = postgres(DB, { onnotice: () => {} });
await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
await sql.end();

const { runMigrations } = await import("../../server/db/migrate.js");
const { createApp } = await import("../../server/app.js");
await runMigrations();

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
const security = vercel.headers[0]!.headers.filter((h) => h.key !== "Strict-Transport-Security");
const dist = join(process.cwd(), "dist");
const types: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".html": "text/html; charset=utf-8", ".png": "image/png", ".json": "application/json" };

const api = createApp();
const app = new Hono();
app.all("/api/*", (c) => api.fetch(c.req.raw));
app.get("/__e2e/state", (c) => c.json({ sent: google.mailbox("alex@fluent.test").sent.length, aiRequests: google.state.aiRequests.length }));
app.get("*", (c) => {
  const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(dist, rel);
  if (!file.startsWith(dist) || !existsSync(file) || rel === "/" || !extname(file)) file = join(dist, "index.html");
  const headers = new Headers({ "content-type": types[extname(file)] ?? "application/octet-stream" });
  for (const h of security) headers.set(h.key, h.value);
  return new Response(readFileSync(file), { headers });
});

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, () => {
  process.stdout.write(`E2E server on http://localhost:${PORT} (fake Google ${google.url}, AI ${AI ? "on" : "off"}, Google ${GOOGLE ? "on" : "off"})\n`);
});
