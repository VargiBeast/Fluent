import { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { unsubActionSchema, unsubArchiveSchema, unsubScanSchema, unsubUndoArchiveSchema } from "../../shared/unsubscribe.js";
import { archiveSenders, scanNewsletters, unarchiveMessages, unsubscribe } from "../services/unsubscribe.js";

/**
 * Unsubscribe assistant. Every write here is the direct result of a user click (the UI sends `confirm: true`);
 * nothing runs automatically and the AI has no access to these routes.
 */
export const unsubscribeRoutes = new Hono<AppEnv>();
unsubscribeRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});

unsubscribeRoutes.get("/senders", rateLimit("unsub_scan", 10), async (c) => {
  const user = requireUser(c);
  const q = unsubScanSchema.parse(c.req.query());
  c.header("Cache-Control", "private, no-store");
  return c.json(await scanNewsletters(user.id, { days: q.days, account: q.account }));
});

unsubscribeRoutes.post("/unsubscribe", rateLimit("unsub_action", 30), async (c) => {
  const user = requireUser(c);
  const b = unsubActionSchema.parse(await c.req.json());
  return c.json(await unsubscribe(user.id, b.accountId, b.messageId, b.method));
});

unsubscribeRoutes.post("/archive", rateLimit("unsub_action", 30), async (c) => {
  const user = requireUser(c);
  const b = unsubArchiveSchema.parse(await c.req.json());
  return c.json(await archiveSenders(user.id, b.senders));
});

unsubscribeRoutes.post("/archive/undo", rateLimit("unsub_action", 30), async (c) => {
  const user = requireUser(c);
  const b = unsubUndoArchiveSchema.parse(await c.req.json());
  return c.json(await unarchiveMessages(user.id, b.items));
});
