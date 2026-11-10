import { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { statsQuerySchema } from "../../shared/stats.js";
import { inboxStats } from "../services/stats.js";

/** Inbox statistics computed live from Gmail metadata (From, date, labels). Nothing is stored. */
export const statsRoutes = new Hono<AppEnv>();
statsRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});
// Each load reads up to a few hundred conversations' metadata, so keep it modest.
statsRoutes.use("*", rateLimit("stats", 10));

statsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  const q = statsQuerySchema.parse(c.req.query());
  c.header("Cache-Control", "private, max-age=60");
  return c.json(await inboxStats(user.id, { days: q.days, account: q.account, tz: q.tz }));
});
