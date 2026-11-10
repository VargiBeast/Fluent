import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { HttpError } from "./lib/errors.js";
import { logger } from "./logger.js";
import { aiConfigured, aiProvider, getEnv, googleConfigured, microsoftConfigured } from "./env.js";
import { aiModelId } from "./ai/core.js";
import type { AppEnv } from "./lib/context.js";
import { sessionMiddleware } from "./auth/session.js";
import { csrfMiddleware } from "./lib/csrf.js";
import { authRoutes } from "./routes/auth.js";
import { mailRoutes } from "./routes/mail.js";
import { composeRoutes } from "./routes/compose.js";
import { aiRoutes } from "./routes/ai.js";
import { settingsRoutes } from "./routes/settings.js";
import { copilotRoutes } from "./routes/copilot.js";
import { templateRoutes } from "./routes/templates.js";
import { noteRoutes } from "./routes/notes.js";
import { unsubscribeRoutes } from "./routes/unsubscribe.js";
import { sendAsRoutes } from "./routes/sendas.js";
import { statsRoutes } from "./routes/stats.js";
import { mailAccountRoutes } from "./routes/mailAccounts.js";
import { sql } from "drizzle-orm";
import { getDb, hasDatabase } from "./db/client.js";
import { clientIp, hit } from "./lib/rateLimit.js";
import { deepChecks } from "./lib/readiness.js";

export function createApp() {
  const app = new Hono<AppEnv>().basePath("/api");

  app.use("*", secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
    crossOriginResourcePolicy: "same-origin",
    referrerPolicy: "no-referrer",
  }));

  app.use("*", async (c, next) => {
    const start = performance.now();
    await next();
    c.header("Cache-Control", c.res.headers.get("Cache-Control") ?? "no-store");
    // Only metadata is logged: never bodies, queries, subjects or tokens.
    logger.info({
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      ms: Math.round(performance.now() - start),
      user: c.get("user")?.id,
    }, "request");
  });

  app.get("/health", (c) => c.json({ ok: true }));
  // Readiness: proves the DB is reachable and the app role can query the schema. Never leaks errors.
  // `?deep=1` also verifies the AI key (tiny synthetic prompt, output discarded) and the Google OAuth
  // client (bogus-code exchange). Deep checks are rate limited per IP and globally, and cached for 60s.
  app.get("/ready", async (c) => {
    if (!hasDatabase()) return c.json({ ok: false, database: "not_configured" }, 503);
    let database: "ok" | "error" = "ok";
    try {
      await getDb().execute(sql`select 1 from "users" limit 1`);
    } catch (err) {
      logger.warn({ err: { name: (err as Error).name, code: (err as { code?: string }).code } }, "readiness_db_error");
      database = "error";
    }
    if (c.req.query("deep") !== "1" || database !== "ok") {
      return c.json({ ok: database === "ok", database }, database === "ok" ? 200 : 503);
    }
    const perIp = await hit(`ready_deep:ip:${clientIp(c)}`, 5, 600);
    const global = await hit("ready_deep:global", 30, 3600);
    if (!perIp.ok || !global.ok) {
      c.header("Retry-After", String(Math.max(perIp.ok ? 0 : perIp.retryAfter, global.ok ? 0 : global.retryAfter)));
      return c.json({ error: { code: "rate_limited", message: "Too many requests. Please slow down and try again shortly." } }, 429);
    }
    const deep = await deepChecks();
    const ok = deep.ai === "ok" && deep.googleClient === "ok";
    return c.json({ ok, database, ai: deep.ai, googleClient: deep.googleClient, cached: deep.cached }, ok ? 200 : 503);
  });
  app.get("/config", (c) =>
    c.json({
      google: googleConfigured(),
      microsoft: microsoftConfigured(),
      ai: aiConfigured(),
      database: hasDatabase(),
      aiProvider: aiProvider(),
      aiModel: aiModelId(),
    }),
  );

  app.use("*", sessionMiddleware);
  app.use("*", csrfMiddleware);

  app.route("/auth", authRoutes);
  app.route("/mail", mailRoutes);
  app.route("/compose", composeRoutes);
  app.route("/ai", aiRoutes);
  app.route("/copilot", copilotRoutes);
  app.route("/templates", templateRoutes);
  app.route("/notes", noteRoutes);
  app.route("/newsletters", unsubscribeRoutes);
  app.route("/send-as", sendAsRoutes);
  app.route("/stats", statsRoutes);
  app.route("/mail-accounts", mailAccountRoutes);
  app.route("/", settingsRoutes);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "Not found" } }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    if (err instanceof ZodError) {
      return c.json({ error: { code: "validation_error", message: "Invalid input", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } }, 400);
    }
    logger.error({ err: { name: err.name, message: err.message, stack: getEnv().NODE_ENV === "production" ? undefined : err.stack }, route: c.req.routePath }, "unhandled_error");
    return c.json({ error: { code: "internal_error", message: "Something went wrong. Please try again." } }, 500);
  });

  return app;
}
