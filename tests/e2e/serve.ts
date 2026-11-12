import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApp } from "../../server/app.js";
import { closeDb } from "../../server/db/client.js";
import { resetEnv } from "../../server/env.js";
import { startFakeGoogle } from "../fakes/google.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const GOOGLE = process.env.E2E_GOOGLE !== "0";
const AI = process.env.E2E_AI !== "0";

const google = await startFakeGoogle();
Object.assign(process.env, {
  NODE_ENV: "test",
  APP_URL: "http://127.0.0.1:4173",
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  DATABASE_SSL: process.env.DATABASE_SSL ?? "disable",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  GOOGLE_CLIENT_ID: GOOGLE ? google.state.clientId : "",
  GOOGLE_CLIENT_SECRET: GOOGLE ? google.state.clientSecret : "",
  MAILIQ_TEST_GOOGLE_BASE: google.url,
  MAILIQ_TEST_AI_BASE: `${google.url}/v1`,
  AI_PROVIDER: "",
  GOOGLE_GENERATIVE_AI_API_KEY: AI ? "fake-gemini-key" : "",
  XAI_API_KEY: "",
  OPENAI_API_KEY: "",
  LOG_LEVEL: "error",
  SESSION_TTL_DAYS: "7",
});
resetEnv();

const app = createApp();
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/api")) {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
    const r = await app.fetch(new Request(`http://127.0.0.1${url.pathname}${url.search}`, { method: req.method, headers, body }));
    res.statusCode = r.status;
    r.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  // static from dist
  const { createReadStream, existsSync } = await import("node:fs");
  const path = join(root, "dist", url.pathname === "/" ? "index.html" : url.pathname);
  if (!existsSync(path)) {
    res.statusCode = 404;
    res.end("not found");
    return;
  }
  createReadStream(path).pipe(res);
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, "127.0.0.1", () => {
  console.log(`e2e serve on http://127.0.0.1:${port}`);
});

process.on("SIGINT", async () => {
  server.close();
  await closeDb();
  await google.close();
  process.exit(0);
});
