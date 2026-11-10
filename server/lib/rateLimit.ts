import type { Context, MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import type { AppEnv } from "./context.js";
import { getDb } from "../db/client.js";
import { rateLimits } from "../db/schema.js";
import { HttpError } from "./errors.js";

export function clientIp(c: Context): string {
  const fwd = c.req.header("x-forwarded-for");
  return (fwd?.split(",")[0] ?? c.req.header("x-real-ip") ?? "unknown").trim();
}

/** Fixed-window counter in Postgres so limits hold across serverless instances. */
export async function hit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const rows = await getDb()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({ target: [rateLimits.key, rateLimits.windowStart], set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });
  const count = rows[0]?.count ?? 1;
  // Opportunistic cleanup of stale windows (~1% of hits).
  if (Math.random() < 0.01) {
    await getDb().execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  }
  return { ok: count <= limit, retryAfter: Math.ceil((windowStart.getTime() + windowSec * 1000 - now) / 1000) };
}

export function rateLimit(bucket: string, limit: number, windowSec = 60): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const who = c.get("user")?.id ?? `ip:${clientIp(c)}`;
    const r = await hit(`${bucket}:${who}`, limit, windowSec);
    if (!r.ok) {
      c.header("Retry-After", String(r.retryAfter));
      throw new HttpError(429, "rate_limited", "Too many requests. Please slow down and try again shortly.");
    }
    await next();
  };
}
