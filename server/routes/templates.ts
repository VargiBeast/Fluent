import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { templateInputSchema } from "../../shared/templates.js";
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from "../services/templates.js";

const uuid = z.string().uuid();

export const templateRoutes = new Hono<AppEnv>();
templateRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});
templateRoutes.use("*", rateLimit("templates", 120));

templateRoutes.get("/", async (c) => {
  const user = requireUser(c);
  return c.json({ templates: await listTemplates(user.id) });
});

templateRoutes.post("/", async (c) => {
  const user = requireUser(c);
  return c.json(await createTemplate(user.id, templateInputSchema.parse(await c.req.json())), 201);
});

templateRoutes.put("/:id", async (c) => {
  const user = requireUser(c);
  return c.json(await updateTemplate(user.id, uuid.parse(c.req.param("id")), templateInputSchema.parse(await c.req.json())));
});

templateRoutes.delete("/:id", async (c) => {
  const user = requireUser(c);
  await deleteTemplate(user.id, uuid.parse(c.req.param("id")));
  return c.json({ ok: true });
});
