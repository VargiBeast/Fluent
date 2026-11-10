import { randomUUID } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { templates } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { HttpError, notFound } from "../lib/errors.js";
import { TEMPLATE_LIMITS, type Template, type TemplateInput } from "../../shared/templates.js";

const PURPOSE = "template";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Bound to both the owner and the row, so ciphertext can't be moved between users or rows.
const aad = (userId: string, id: string) => `${userId}:${id}`;

type Row = typeof templates.$inferSelect;

function toTemplate(r: Row): Template {
  const a = aad(r.userId, r.id);
  return {
    id: r.id,
    name: decrypt(r.nameEnc, PURPOSE, a),
    subject: decrypt(r.subjectEnc, PURPOSE, a),
    body: decrypt(r.bodyEnc, PURPOSE, a),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function sealed(userId: string, id: string, t: TemplateInput) {
  const a = aad(userId, id);
  return { nameEnc: encrypt(t.name, PURPOSE, a), subjectEnc: encrypt(t.subject, PURPOSE, a), bodyEnc: encrypt(t.body, PURPOSE, a) };
}

/** Sorted by name (decrypted, so sorting happens here rather than in SQL). */
export async function listTemplates(userId: string): Promise<Template[]> {
  const rows = await getDb().select().from(templates).where(eq(templates.userId, userId)).orderBy(asc(templates.createdAt)).limit(TEMPLATE_LIMITS.maxPerUser);
  return rows.map(toTemplate).sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
}

export async function createTemplate(userId: string, t: TemplateInput): Promise<Template> {
  const db = getDb();
  const [n] = await db.select({ n: count() }).from(templates).where(eq(templates.userId, userId));
  if ((n?.n ?? 0) >= TEMPLATE_LIMITS.maxPerUser) throw new HttpError(400, "template_limit", `You can keep up to ${TEMPLATE_LIMITS.maxPerUser} templates. Delete one first.`);
  const id = randomUUID();
  const [row] = await db.insert(templates).values({ id, userId, ...sealed(userId, id, t) }).returning();
  return toTemplate(row!);
}

export async function updateTemplate(userId: string, id: string, t: TemplateInput): Promise<Template> {
  if (!UUID.test(id)) throw notFound("Template not found");
  const [row] = await getDb().update(templates).set({ ...sealed(userId, id, t), updatedAt: new Date() })
    .where(and(eq(templates.id, id), eq(templates.userId, userId))).returning();
  if (!row) throw notFound("Template not found");
  return toTemplate(row);
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  if (!UUID.test(id)) throw notFound("Template not found");
  const rows = await getDb().delete(templates).where(and(eq(templates.id, id), eq(templates.userId, userId))).returning({ id: templates.id });
  if (!rows.length) throw notFound("Template not found");
}

export async function countTemplates(userId: string): Promise<number> {
  const [n] = await getDb().select({ n: count() }).from(templates).where(eq(templates.userId, userId));
  return n?.n ?? 0;
}
