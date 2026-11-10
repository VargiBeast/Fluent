import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { CATEGORIES, FOLDERS, THREAD_ACTIONS } from "../../shared/mail.js";
import {
  createFilter, createLabel, deleteFilter, deleteLabel, getAttachment, getLabels, getThread, listDrafts,
  listFilters, listThreads, modifyLabels, renameLabel, syncChanges, threadAction, bulkAction, BULK_ACTIONS, BULK_MAX,
} from "../services/mail.js";
import { logSecurityEvent } from "../services/accounts.js";
import { cancelSnooze, listSnoozes, processDueSnoozes, setSnooze } from "../services/snooze.js";
import { addReadLater, listReadLater, listReadLaterThreads, removeReadLater } from "../services/readLater.js";

const uuid = z.string().uuid();
const gid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);

const listQuery = z.object({
  account: z.union([z.literal("all"), uuid]).optional(),
  folder: z.enum(FOLDERS).default("inbox"),
  category: z.enum(CATEGORIES).optional(),
  label: gid.optional(),
  q: z.string().max(500).optional(),
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(5).max(50).default(25),
  filter: z.enum(["unanswered"]).optional(),
});

export const mailRoutes = new Hono<AppEnv>();
mailRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});
mailRoutes.use("*", rateLimit("mail", 240));

mailRoutes.get("/threads", async (c) => {
  const user = requireUser(c);
  const q = listQuery.parse(c.req.query());
  if (q.folder === "later") return c.json(await listReadLaterThreads(user.id, { account: q.account, cursor: q.cursor, limit: q.limit }));
  return c.json(await listThreads(user.id, q));
});

mailRoutes.get("/threads/:accountId/:threadId", async (c) => {
  const user = requireUser(c);
  return c.json(await getThread(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("threadId"))));
});

mailRoutes.post("/threads/:accountId/:threadId/action", async (c) => {
  const user = requireUser(c);
  const { action } = z.object({ action: z.enum(THREAD_ACTIONS) }).strict().parse(await c.req.json());
  await threadAction(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("threadId")), action);
  return c.json({ ok: true });
});

mailRoutes.post("/threads/:accountId/:threadId/labels", async (c) => {
  const user = requireUser(c);
  const body = z.object({ add: z.array(gid).max(20).default([]), remove: z.array(gid).max(20).default([]) }).strict().parse(await c.req.json());
  await modifyLabels(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("threadId")), body.add, body.remove);
  return c.json({ ok: true });
});

mailRoutes.get("/attachments/:accountId/:messageId/:attachmentId", async (c) => {
  const user = requireUser(c);
  const q = z.object({ name: z.string().max(255).default("attachment"), inline: z.enum(["1"]).optional() }).parse(c.req.query());
  const data = await getAttachment(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("messageId")), z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).parse(c.req.param("attachmentId")));
  const safeName = q.name.replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120) || "attachment";
  // Always served as an opaque download; never rendered by the browser as HTML/JS.
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-store",
      "content-length": String(data.length),
    },
  });
});

mailRoutes.get("/labels", async (c) => {
  const user = requireUser(c);
  const { account } = z.object({ account: z.union([z.literal("all"), uuid]).optional() }).parse(c.req.query());
  return c.json(await getLabels(user.id, account));
});

// eslint-disable-next-line no-control-regex
const labelName = z.string().trim().min(1).max(225).refine((s) => !/[\u0000-\u001f]/.test(s), "Invalid characters");

mailRoutes.post("/labels", async (c) => {
  const user = requireUser(c);
  const body = z.object({ accountId: uuid, name: labelName }).strict().parse(await c.req.json());
  return c.json(await createLabel(user.id, body.accountId, body.name), 201);
});

mailRoutes.patch("/labels/:accountId/:labelId", async (c) => {
  const user = requireUser(c);
  const body = z.object({ name: labelName }).strict().parse(await c.req.json());
  return c.json(await renameLabel(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("labelId")), body.name));
});

mailRoutes.delete("/labels/:accountId/:labelId", async (c) => {
  const user = requireUser(c);
  await deleteLabel(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("labelId")));
  return c.json({ ok: true });
});

const filterSchema = z.object({
  accountId: uuid,
  criteria: z.object({
    from: z.string().max(254).optional(),
    to: z.string().max(254).optional(),
    subject: z.string().max(200).optional(),
    query: z.string().max(300).optional(),
    hasAttachment: z.boolean().optional(),
  }).strict().refine((cr) => Object.values(cr).some((v) => v !== undefined && v !== ""), "Add at least one condition"),
  action: z.object({
    addLabelIds: z.array(gid).max(5).optional(),
    removeLabelIds: z.array(z.enum(["INBOX", "UNREAD", "IMPORTANT"])).max(3).optional(),
  }).strict().refine((a) => (a.addLabelIds?.length ?? 0) + (a.removeLabelIds?.length ?? 0) > 0, "Choose at least one action"),
}).strict();

mailRoutes.get("/filters", async (c) => {
  const user = requireUser(c);
  const { account } = z.object({ account: uuid }).parse(c.req.query());
  return c.json({ filters: await listFilters(user.id, account) });
});

mailRoutes.post("/filters", async (c) => {
  const user = requireUser(c);
  const body = filterSchema.parse(await c.req.json());
  const f = await createFilter(user.id, body.accountId, { criteria: body.criteria, action: body.action });
  await logSecurityEvent(user.id, "filter_created");
  return c.json(f, 201);
});

mailRoutes.delete("/filters/:accountId/:filterId", async (c) => {
  const user = requireUser(c);
  await deleteFilter(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("filterId")));
  return c.json({ ok: true });
});

mailRoutes.get("/sync", async (c) => {
  const user = requireUser(c);
  // Due snoozes/reminders come back first, so the history sync below picks up the change.
  const due = await processDueSnoozes(user.id).catch(() => ({ returned: 0, reminders: 0 }));
  const r = await syncChanges(user.id);
  return c.json({ ...r, changed: r.changed || due.returned + due.reminders > 0, snoozeReturned: due.returned, remindersDue: due.reminders });
});

mailRoutes.post("/bulk", rateLimit("bulk", 30), async (c) => {
  const user = requireUser(c);
  const b = z.object({
    items: z.array(z.object({ accountId: uuid, threadId: gid }).strict()).min(1).max(BULK_MAX),
    action: z.enum(BULK_ACTIONS),
    labelId: gid.optional(),
  }).strict().parse(await c.req.json());
  return c.json(await bulkAction(user.id, b));
});

mailRoutes.get("/snoozes", async (c) => {
  const user = requireUser(c);
  return c.json({ snoozes: await listSnoozes(user.id) });
});

mailRoutes.post("/snoozes", rateLimit("snooze", 60), async (c) => {
  const user = requireUser(c);
  const b = z.object({ accountId: z.string().uuid(), threadId: z.string(), until: z.string().datetime({ offset: true }), kind: z.enum(["snooze", "remind"]) }).strict().parse(await c.req.json());
  return c.json(await setSnooze(user.id, b));
});

mailRoutes.delete("/snoozes/:accountId/:threadId", async (c) => {
  const user = requireUser(c);
  await cancelSnooze(user.id, z.string().uuid().parse(c.req.param("accountId")), c.req.param("threadId"));
  return c.json({ ok: true });
});

mailRoutes.get("/read-later", async (c) => {
  const user = requireUser(c);
  return c.json({ items: await listReadLater(user.id) });
});

mailRoutes.post("/read-later", async (c) => {
  const user = requireUser(c);
  const b = z.object({ accountId: uuid, threadId: gid }).strict().parse(await c.req.json());
  return c.json(await addReadLater(user.id, b.accountId, b.threadId));
});

mailRoutes.delete("/read-later/:accountId/:threadId", async (c) => {
  const user = requireUser(c);
  const removed = await removeReadLater(user.id, uuid.parse(c.req.param("accountId")), gid.parse(c.req.param("threadId")));
  return c.json({ ok: true, removed });
});

mailRoutes.get("/drafts", async (c) => {
  const user = requireUser(c);
  const { account } = z.object({ account: z.union([z.literal("all"), uuid]).optional() }).parse(c.req.query());
  return c.json({ drafts: await listDrafts(user.id, account) });
});
