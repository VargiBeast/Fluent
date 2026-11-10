import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { aiConfigured } from "../env.js";
import { answerAboutThread, askInbox, buildOverview, draftEmail, explainThread, interpretSearch, loadPolicy, rewriteText, securityReview, threadInsights } from "../ai/features.js";

const uuid = z.string().uuid();
const gid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

export const aiRoutes = new Hono<AppEnv>();
aiRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});
aiRoutes.use("*", rateLimit("ai", 30));

aiRoutes.post("/insights", async (c) => {
  const user = requireUser(c);
  const b = z.object({ accountId: uuid, threadId: gid }).strict().parse(await c.req.json());
  return c.json(await threadInsights(user.id, b.accountId, b.threadId));
});

aiRoutes.post("/security", async (c) => {
  const user = requireUser(c);
  const b = z.object({ accountId: uuid, threadId: gid, messageId: gid }).strict().parse(await c.req.json());
  return c.json(await securityReview(user.id, b.accountId, b.threadId, b.messageId));
});

aiRoutes.post("/draft", async (c) => {
  const user = requireUser(c);
  const b = z.object({
    accountId: uuid.optional(),
    threadId: gid.optional(),
    mode: z.enum(["new", "reply", "forward"]).default("new"),
    instruction: z.string().max(1000).optional(),
  }).strict().refine((x) => Boolean(x.accountId) === Boolean(x.threadId), "accountId and threadId go together").parse(await c.req.json());
  return c.json(await draftEmail(user.id, b));
});

aiRoutes.post("/rewrite", async (c) => {
  const user = requireUser(c);
  const b = z.object({ text: z.string().min(1).max(8000), operation: z.enum(["shorter", "longer", "fix", "tone"]), tone: z.string().max(30).optional() }).strict().parse(await c.req.json());
  return c.json(await rewriteText(user.id, b));
});

aiRoutes.post("/search", async (c) => {
  const user = requireUser(c);
  const b = z.object({ query: z.string().trim().min(2).max(500), accountId: uuid.optional() }).strict().parse(await c.req.json());
  return c.json(await interpretSearch(user.id, b.query));
});

aiRoutes.post("/ask", async (c) => {
  const user = requireUser(c);
  const b = z.object({ question: z.string().trim().min(2).max(1000), account: z.union([z.literal("all"), uuid]).optional() }).strict().parse(await c.req.json());
  return c.json(await askInbox(user.id, { question: b.question, account: b.account }));
});

aiRoutes.post("/copilot", async (c) => {
  const user = requireUser(c);
  const b = z.object({
    message: z.string().trim().min(1).max(1000),
    action: z.enum(["ask", "explain"]).default("ask"),
    context: z.object({ accountId: uuid, threadId: gid }).strict().optional(),
    account: z.union([z.literal("all"), uuid]).optional(),
  }).strict().parse(await c.req.json());
  if (b.context) {
    const text = b.action === "explain"
      ? await explainThread(user.id, b.context.accountId, b.context.threadId)
      : await answerAboutThread(user.id, b.context.accountId, b.context.threadId, b.message);
    return c.json({ answer: text, citations: [] });
  }
  const r = await askInbox(user.id, { question: b.message, account: b.account });
  return c.json(r);
});

aiRoutes.get("/overview", async (c) => {
  const user = requireUser(c);
  const { account } = z.object({ account: z.union([z.literal("all"), uuid]).optional() }).parse(c.req.query());
  return c.json(await buildOverview(user.id, account, async () => (aiConfigured() ? loadPolicy(user.id) : null)));
});
