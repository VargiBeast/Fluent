import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import type { AppEnv } from "../lib/context.js";
import { destroySession, requireUser } from "../auth/session.js";
import { getDb } from "../db/client.js";
import { accounts, aiAudit, securityEvents, sessions, userSettings, users } from "../db/schema.js";
import { parseSettings, settingsPatchSchema } from "../../shared/settings.js";
import { getOwnedAccount, listAccounts, logSecurityEvent, toPublicAccount } from "../services/accounts.js";
import { decrypt } from "../crypto.js";
import { revokeToken } from "../auth/google.js";
import { clearAudit, listAudit, purgeAudit } from "../ai/policy.js";
import { rateLimit } from "../lib/rateLimit.js";
import { badRequest } from "../lib/errors.js";
import { countTemplates, listTemplates } from "../services/templates.js";
import { listReadLater } from "../services/readLater.js";

export const settingsRoutes = new Hono<AppEnv>();

settingsRoutes.use("/settings/*", rateLimit("settings", 120));
settingsRoutes.use("/privacy/*", rateLimit("privacy", 60));

settingsRoutes.get("/settings", async (c) => {
  const user = requireUser(c);
  const rows = await getDb().select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  return c.json({ settings: parseSettings(rows[0]?.data), onboarded: rows[0]?.onboarded ?? false });
});

settingsRoutes.patch("/settings", async (c) => {
  const user = requireUser(c);
  const patch = settingsPatchSchema.parse(await c.req.json());
  const db = getDb();
  const rows = await db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1);
  const current = parseSettings(rows[0]?.data);
  const { onboarded, ...sections } = patch;
  const next = parseSettings({
    ...current,
    ...Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, { ...(current as Record<string, object>)[k], ...v }])),
  });
  await db.insert(userSettings)
    .values({ userId: user.id, data: next, onboarded: onboarded ?? rows[0]?.onboarded ?? false })
    .onConflictDoUpdate({ target: userSettings.userId, set: { data: next, updatedAt: new Date(), ...(onboarded !== undefined ? { onboarded } : {}) } });
  if (patch.ai?.excludedLabels || patch.ai?.excludedSenders) await logSecurityEvent(user.id, "ai_exclusions_updated");
  if (patch.privacy?.keepAiHistoryDays !== undefined) await purgeAudit(user.id, next.privacy.keepAiHistoryDays);
  if (patch.ai?.enabled !== undefined) await logSecurityEvent(user.id, patch.ai.enabled ? "ai_enabled" : "ai_disabled");
  return c.json({ settings: next });
});

// ---- Sessions & security ----
settingsRoutes.get("/security/sessions", async (c) => {
  const user = requireUser(c);
  const rows = await getDb().select().from(sessions).where(eq(sessions.userId, user.id)).orderBy(desc(sessions.lastSeenAt));
  return c.json({
    sessions: rows.map((s) => ({ id: s.id.slice(0, 16), current: s.id === c.get("sessionId"), userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), expiresAt: s.expiresAt.toISOString() })),
  });
});

settingsRoutes.post("/security/sessions/revoke-others", async (c) => {
  const user = requireUser(c);
  const r = await getDb().delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, c.get("sessionId") ?? ""))).returning({ id: sessions.id });
  await logSecurityEvent(user.id, "sessions_revoked", String(r.length));
  return c.json({ revoked: r.length });
});

settingsRoutes.delete("/security/sessions/:prefix", async (c) => {
  const user = requireUser(c);
  const prefix = z.string().regex(/^[0-9a-f]{16}$/).parse(c.req.param("prefix"));
  const rows = await getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id));
  const target = rows.find((r) => r.id.startsWith(prefix));
  if (!target) throw badRequest("Session not found");
  if (target.id === c.get("sessionId")) throw badRequest("Use Sign out to end the current session");
  await getDb().delete(sessions).where(and(eq(sessions.id, target.id), eq(sessions.userId, user.id)));
  await logSecurityEvent(user.id, "session_revoked");
  return c.json({ ok: true });
});

settingsRoutes.get("/security/events", async (c) => {
  const user = requireUser(c);
  const rows = await getDb().select().from(securityEvents).where(eq(securityEvents.userId, user.id)).orderBy(desc(securityEvents.createdAt)).limit(50);
  return c.json({ events: rows.map((e) => ({ id: e.id, type: e.type, detail: e.detail, createdAt: e.createdAt.toISOString() })) });
});

// ---- Connected accounts ----
settingsRoutes.get("/accounts", async (c) => {
  const user = requireUser(c);
  return c.json({ accounts: (await listAccounts(user.id)).map(toPublicAccount) });
});

async function revokeAccount(a: typeof accounts.$inferSelect): Promise<boolean> {
  const aad = `${a.userId}:${a.googleSub}`;
  const token = a.refreshTokenEnc ? decrypt(a.refreshTokenEnc, "token", aad) : a.accessTokenEnc ? decrypt(a.accessTokenEnc, "token", aad) : null;
  return token ? revokeToken(token) : true;
}

settingsRoutes.delete("/accounts/:id", async (c) => {
  const user = requireUser(c);
  const a = await getOwnedAccount(user.id, z.string().uuid().parse(c.req.param("id")));
  const revoked = await revokeAccount(a);
  await getDb().delete(accounts).where(and(eq(accounts.id, a.id), eq(accounts.userId, user.id)));
  await logSecurityEvent(user.id, "account_disconnected", a.email);
  return c.json({ ok: true, revokedAtGoogle: revoked });
});

// ---- Privacy dashboard ----
settingsRoutes.get("/privacy/audit", async (c) => {
  const user = requireUser(c);
  return c.json({ entries: await listAudit(user.id, 200) });
});

settingsRoutes.delete("/privacy/audit", async (c) => {
  const user = requireUser(c);
  const n = await clearAudit(user.id);
  await logSecurityEvent(user.id, "ai_history_cleared", String(n));
  return c.json({ deleted: n });
});

settingsRoutes.get("/privacy/data", async (c) => {
  const user = requireUser(c);
  const db = getDb();
  const [accs, sess, events, audit, settingsRow, templateCount, later] = await Promise.all([
    listAccounts(user.id),
    db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id)),
    db.select({ id: securityEvents.id }).from(securityEvents).where(eq(securityEvents.userId, user.id)),
    db.select({ id: aiAudit.id }).from(aiAudit).where(eq(aiAudit.userId, user.id)),
    db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1),
    countTemplates(user.id),
    listReadLater(user.id),
  ]);
  return c.json({
    profile: { email: user.email, name: user.name },
    stored: [
      { key: "profile", label: "Profile", detail: "Google account id, email, name and profile photo URL", count: 1 },
      { key: "accounts", label: "Connected Gmail accounts", detail: "Email, granted scopes, and OAuth tokens encrypted with AES-256-GCM", count: accs.length },
      { key: "sessions", label: "Sign-in sessions", detail: "Hashed session ids, browser user-agent, timestamps", count: sess.length },
      { key: "settings", label: "Preferences", detail: "Appearance, notifications, AI and privacy settings", count: settingsRow.length },
      { key: "ai_audit", label: "AI access log", detail: "Feature, timestamp, Gmail thread ids and encrypted subjects (never bodies)", count: audit.length },
      { key: "security_events", label: "Security log", detail: "Sign-ins, disconnections and setting changes (no email content)", count: events.length },
      { key: "read_later", label: "Read later list", detail: "Gmail thread ids you saved for later and when (no content)", count: later.length },
      { key: "templates", label: "Templates", detail: "Saved replies you wrote (name, subject, text), encrypted with AES-256-GCM", count: templateCount },
    ],
    notStored: ["Email bodies, attachments or snippets (fetched live from Gmail and never written to the database)", "AI prompts or responses", "Contacts or address books"],
  });
});

settingsRoutes.get("/privacy/export", async (c) => {
  const user = requireUser(c);
  const db = getDb();
  const [u, accs, sess, events, audit, settingsRow, tpls, later] = await Promise.all([
    db.select().from(users).where(eq(users.id, user.id)).limit(1),
    listAccounts(user.id),
    db.select().from(sessions).where(eq(sessions.userId, user.id)),
    db.select().from(securityEvents).where(eq(securityEvents.userId, user.id)),
    listAudit(user.id, 10_000),
    db.select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1),
    listTemplates(user.id),
    listReadLater(user.id),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    user: u[0] ? { id: u[0].id, email: u[0].email, name: u[0].name, picture: u[0].picture, createdAt: u[0].createdAt } : null,
    // OAuth tokens are deliberately excluded from exports.
    accounts: accs.map(toPublicAccount),
    settings: parseSettings(settingsRow[0]?.data),
    sessions: sess.map((s) => ({ userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt })),
    securityEvents: events.map((e) => ({ type: e.type, detail: e.detail, createdAt: e.createdAt })),
    aiAccessLog: audit,
    readLater: later,
    templates: tpls.map((t) => ({ name: t.name, subject: t.subject, body: t.body, createdAt: t.createdAt, updatedAt: t.updatedAt })),
  };
  await logSecurityEvent(user.id, "data_exported");
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="fluent-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
});

settingsRoutes.delete("/me", async (c) => {
  const user = requireUser(c);
  const body = z.object({ confirm: z.literal("DELETE") }).strict().parse(await c.req.json());
  void body;
  const accs = await listAccounts(user.id);
  const results = await Promise.all(accs.map((a) => revokeAccount(a)));
  // ON DELETE CASCADE removes accounts, sessions, settings, AI audit and security events.
  await getDb().delete(users).where(eq(users.id, user.id));
  await destroySession(c).catch(() => undefined);
  return c.json({ ok: true, revokedAtGoogle: results.every(Boolean) });
});
