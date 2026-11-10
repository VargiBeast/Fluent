import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { getOwnedAccount } from "../services/accounts.js";
import { GmailClient } from "../gmail/client.js";
import { buildMime, cleanOutgoingHtml, formatAddress, toBase64Url, type MimeAttachment } from "../gmail/mime.js";
import { decodeB64Url, parseAddress, parseMessage, type GmailMessage } from "../gmail/parse.js";
import { HttpError } from "../lib/errors.js";

const MAX_ATTACH_BYTES = 3_500_000; // Vercel Functions cap request bodies at 4.5 MB
const gid = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const addressField = z.string().trim().min(3).max(320).refine((s) => !/[\r\n]/.test(s)).refine((s) => {
  const a = parseAddress(s);
  return z.string().email().safeParse(a.email).success;
}, "Invalid email address");

const attachment = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(127).default("application/octet-stream"),
  size: z.number().int().nonnegative().optional(),
  data: z.string().max(5_000_000).optional(),
  source: z.object({ messageId: gid, attachmentId: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/) }).optional(),
}).refine((a) => Boolean(a.data) !== Boolean(a.source), "Attachment needs data or a Gmail source");

const messageSchema = z.object({
  accountId: z.string().uuid(),
  to: z.array(addressField).max(100).default([]),
  cc: z.array(addressField).max(100).default([]),
  bcc: z.array(addressField).max(100).default([]),
  subject: z.string().max(900).default(""),
  html: z.string().max(2_000_000).default(""),
  text: z.string().max(1_000_000).default(""),
  threadId: gid.optional(),
  inReplyTo: z.string().max(998).optional(),
  references: z.string().max(4000).optional(),
  attachments: z.array(attachment).max(20).default([]),
  draftId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
});

const sendSchema = messageSchema.extend({
  aiGenerated: z.boolean().default(false),
  aiConfirmed: z.boolean().default(false),
}).refine((m) => m.to.length + m.cc.length + m.bcc.length > 0, { message: "Add at least one recipient", path: ["to"] });

type MessageInput = z.infer<typeof messageSchema>;

function normalizeAddr(s: string): string {
  const a = parseAddress(s);
  return formatAddress(a.name !== a.email ? a.name : undefined, a.email);
}

async function buildRaw(gm: GmailClient, m: MessageInput): Promise<string> {
  const attachments: MimeAttachment[] = [];
  let total = 0;
  for (const a of m.attachments) {
    const content = a.data
      ? Buffer.from(a.data, "base64")
      : decodeB64Url((await gm.request<{ data?: string }>("GET", `/messages/${a.source!.messageId}/attachments/${a.source!.attachmentId}`)).data ?? "");
    total += content.length;
    if (total > MAX_ATTACH_BYTES) throw new HttpError(413, "attachments_too_large", "Attachments are limited to 3.5 MB per message in this deployment.");
    attachments.push({ filename: a.filename, mimeType: a.mimeType, content });
  }
  const acc = gm.account;
  return buildMime({
    from: formatAddress(acc.name || undefined, acc.email),
    to: m.to.map(normalizeAddr),
    cc: m.cc.map(normalizeAddr),
    bcc: m.bcc.map(normalizeAddr),
    subject: m.subject,
    html: cleanOutgoingHtml(m.html),
    text: m.text,
    inReplyTo: m.inReplyTo,
    references: m.references,
    attachments,
  });
}

export const composeRoutes = new Hono<AppEnv>();
composeRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});

composeRoutes.post("/send", rateLimit("send", 20), async (c) => {
  const user = requireUser(c);
  const body = sendSchema.parse(await c.req.json());
  // Server-side guarantee: AI-written content can never be sent without explicit user confirmation.
  if (body.aiGenerated && !body.aiConfirmed) {
    throw new HttpError(409, "ai_confirmation_required", "Please review and confirm AI-generated content before sending.");
  }
  const gm = new GmailClient(await getOwnedAccount(user.id, body.accountId));
  const raw = toBase64Url(await buildRaw(gm, body));
  let sent: { id: string; threadId: string };
  if (body.draftId) {
    await gm.request("PUT", `/drafts/${body.draftId}`, { body: { id: body.draftId, message: { raw, threadId: body.threadId } } });
    sent = await gm.request("POST", "/drafts/send", { body: { id: body.draftId } });
  } else {
    sent = await gm.request("POST", "/messages/send", { body: { raw, threadId: body.threadId } });
  }
  return c.json({ id: sent.id, threadId: sent.threadId });
});

composeRoutes.post("/drafts", rateLimit("drafts", 60), async (c) => {
  const user = requireUser(c);
  const body = messageSchema.parse(await c.req.json());
  const gm = new GmailClient(await getOwnedAccount(user.id, body.accountId));
  const raw = toBase64Url(await buildRaw(gm, body));
  const message = { raw, threadId: body.threadId };
  const r = body.draftId
    ? await gm.request<{ id: string; message: { id: string; threadId: string } }>("PUT", `/drafts/${body.draftId}`, { body: { id: body.draftId, message } })
    : await gm.request<{ id: string; message: { id: string; threadId: string } }>("POST", "/drafts", { body: { message } });
  return c.json({ draftId: r.id, messageId: r.message.id, threadId: r.message.threadId });
});

composeRoutes.get("/drafts/:accountId/:draftId", async (c) => {
  const user = requireUser(c);
  const acc = await getOwnedAccount(user.id, z.string().uuid().parse(c.req.param("accountId")));
  const draftId = gid.parse(c.req.param("draftId"));
  const gm = new GmailClient(acc);
  const d = await gm.request<{ id: string; message: GmailMessage }>("GET", `/drafts/${draftId}`, { query: { format: "full" } });
  const m = parseMessage(d.message, acc.email);
  const header = (n: string) => d.message.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
  return c.json({
    draftId: d.id,
    accountId: acc.id,
    messageId: m.id,
    threadId: m.threadId,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject,
    html: m.bodyHtml,
    text: m.bodyText,
    inReplyTo: header("in-reply-to") ?? null,
    references: header("references") ?? null,
    attachments: m.attachments.filter((a) => !a.inline),
  });
});

composeRoutes.delete("/drafts/:accountId/:draftId", async (c) => {
  const user = requireUser(c);
  const acc = await getOwnedAccount(user.id, z.string().uuid().parse(c.req.param("accountId")));
  const draftId = gid.parse(c.req.param("draftId"));
  await new GmailClient(acc).request("DELETE", `/drafts/${draftId}`);
  return c.json({ ok: true });
});

