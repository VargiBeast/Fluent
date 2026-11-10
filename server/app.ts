import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import { HttpError } from "./lib/errors.js";
import { logger } from "./logger.js";
import { aiConfigured, getEnv, googleConfigured } from "./env.js";
import type { AppEnv } from "./lib/context.js";
import { sessionMiddleware } from "./auth/session.js";
import { csrfMiddleware } from "./lib/csrf.js";
import { authRoutes } from "./routes/auth.js";
import { mailRoutes } from "./routes/mail.js";
import { composeRoutes } from "./routes/compose.js";
import { aiRoutes } from "./routes/ai.js";
import { settingsRoutes } from "./routes/settings.js";
import { sql } from "drizzle-orm";
import { getDb, hasDatabase } from "./db/client.js";

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
  app.get("/ready", async (c) => {
    if (!hasDatabase()) return c.json({ ok: false, database: "not_configured" }, 503);
    try {
      await getDb().execute(sql`select 1 from "users" limit 1`);
      return c.json({ ok: true, database: "ok" });
    } catch (err) {
      logger.warn({ err: { name: (err as Error).name, code: (err as { code?: string }).code } }, "readiness_db_error");
      return c.json({ ok: false, database: "error" }, 503);
    }
  });
  app.get("/config", (c) =>
    c.json({
      google: googleConfigured(),
      ai: aiConfigured(),
      database: hasDatabase(),
      aiProvider: getEnv().AI_PROVIDER,
    }),
  );

  app.use("*", sessionMiddleware);
  app.use("*", csrfMiddleware);

  app.route("/auth", authRoutes);
  app.route("/mail", mailRoutes);
  app.route("/compose", composeRoutes);
  app.route("/ai", aiRoutes);
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
