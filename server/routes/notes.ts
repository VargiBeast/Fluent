import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { noteInputSchema } from "../../shared/notes.js";
import { deleteNote, getNote, saveNote } from "../services/notes.js";

const uuid = z.string().uuid();
const gid = z.string().regex(/^[A-Za-z0-9_=.~-]{1,256}$/);

/** Private notes on conversations: /api/notes/:accountId/:threadId (GET, PUT, DELETE). */
export const noteRoutes = new Hono<AppEnv>();
noteRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});
noteRoutes.use("*", rateLimit("notes", 240));

const params = (c: { req: { param: (k: string) => string } }) => ({ accountId: uuid.parse(c.req.param("accountId")), threadId: gid.parse(c.req.param("threadId")) });

noteRoutes.get("/:accountId/:threadId", async (c) => {
  const user = requireUser(c);
  const p = params(c);
  return c.json({ note: await getNote(user.id, p.accountId, p.threadId) });
});

noteRoutes.put("/:accountId/:threadId", async (c) => {
  const user = requireUser(c);
  const p = params(c);
  const { body } = noteInputSchema.parse(await c.req.json());
  return c.json({ note: await saveNote(user.id, p.accountId, p.threadId, body) });
});

noteRoutes.delete("/:accountId/:threadId", async (c) => {
  const user = requireUser(c);
  const p = params(c);
  return c.json({ ok: true, removed: await deleteNote(user.id, p.accountId, p.threadId) });
});
