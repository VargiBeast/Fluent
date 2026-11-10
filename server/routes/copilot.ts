import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { HttpError } from "../lib/errors.js";
import { COPILOT_LIMITS } from "../../shared/copilot.js";
import { cancelPlan, createPlan, executePlan, executeUndo } from "../copilot/service.js";

const uuid = z.string().uuid();
const gid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const threadKey = z.string().regex(/^[0-9a-f-]{36}:(?:[A-Za-z0-9_-]{1,128}|new)$/i);

export const copilotRoutes = new Hono<AppEnv>();
copilotRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});

function sessionOf(c: { get: (k: "sessionId") => string | undefined }): string {
  const s = c.get("sessionId");
  if (!s) throw new HttpError(401, "unauthenticated", "Please sign in.");
  return s;
}

// Planning calls the AI (and may draft replies), so it shares a tight budget.
copilotRoutes.post("/plan", rateLimit("copilot_plan", 10), async (c) => {
  const user = requireUser(c);
  const b = z.object({
    instruction: z.string().trim().min(2).max(1000),
    context: z.object({ accountId: uuid, threadId: gid }).strict().optional(),
    account: z.union([z.literal("all"), uuid]).optional(),
  }).strict().parse(await c.req.json());
  return c.json(await createPlan(user.id, sessionOf(c), b));
});

copilotRoutes.post("/plans/:id/execute", rateLimit("copilot_exec", 20), async (c) => {
  const user = requireUser(c);
  const b = z.object({
    selections: z.array(z.object({ index: z.number().int().min(0).max(COPILOT_LIMITS.maxActions - 1), keys: z.array(threadKey).max(COPILOT_LIMITS.maxThreadsPerAction) }).strict()).min(1).max(COPILOT_LIMITS.maxActions),
    confirmTrash: z.boolean().optional(),
    confirmSend: z.boolean().optional(),
  }).strict().parse(await c.req.json());
  return c.json(await executePlan(user.id, sessionOf(c), uuid.parse(c.req.param("id")), b));
});

copilotRoutes.post("/plans/:id/cancel", rateLimit("copilot_exec", 20), async (c) => {
  const user = requireUser(c);
  await cancelPlan(user.id, sessionOf(c), uuid.parse(c.req.param("id")));
  return c.json({ ok: true });
});

copilotRoutes.post("/undo/:id", rateLimit("copilot_exec", 20), async (c) => {
  const user = requireUser(c);
  return c.json(await executeUndo(user.id, sessionOf(c), uuid.parse(c.req.param("id"))));
});
