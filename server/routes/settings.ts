import { Hono } from "hono";
import { clearBriefs } from "../ai/brief.js";
import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import type { AppEnv } from "../lib/context.js";
import { destroySession, requireUser } from "../auth/session.js";
import { getDb } from "../db/client.js";
import { accounts, aiAudit, securityEvents, sessions, userSettings, users, dailyBriefs } from "../db/schema.js";
import { DELETE_ACCOUNT_PHRASE, parseSettings, settingsPatchSchema } from "../../shared/settings.js";
import { getOwnedAccount, listAccounts, logSecurityEvent, toPublicAccount } from "../services/accounts.js";
import { decrypt } from "../crypto.js";
import { revokeToken } from "../auth/google.js";
import { clearAudit, listAudit, purgeAudit } from "../ai/policy.js";
import { rateLimit } from "../lib/rateLimit.js";
import { badRequest } from "../lib/errors.js";
import { countTemplates, listTemplates } from "../services/templates.js";
import { listReadLater } from "../services/readLater.js";
import { countNotes, listNotes } from "../services/notes.js";

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
  const nextOnboarded = onboarded !== undefined ? onboarded : (rows[0]?.onboarded ?? false);
  await db.insert(userSettings)
    .values({ userId: user.id, data: next, onboarded: nextOnboarded })
    .onConflictDoUpdate({ target: userSettings.userId, set: { data: next, updatedAt: new Date(), ...(onboarded !== undefined ? { onboarded } : {}) } });
  if (patch.ai?.excludedLabels || patch.ai?.excludedSenders) await logSecurityEvent(user.id, "ai_exclusions_updated");
  if (patch.privacy?.keepAiHistoryDays !== undefined) await purgeAudit(user.id, next.privacy.keepAiHistoryDays);
  if (patch.ai?.enabled !== undefined) await logSecurityEvent(user.id, patch.ai.enabled ? "ai_enabled" : "ai_disabled");
  // Include onboarded so clients can refresh the session gate without a full /auth/session refetch.
  return c.json({ settings: next, onboarded: nextOnboarded });
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

/** Sign out everywhere, this browser included. */
settingsRoutes.post("/security/sessions/revoke-all", async (c) => {
  const user = requireUser(c);
  const r = await getDb().delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id });
  await logSecurityEvent(user.id, "sessions_revoked", String(r.length));
  await destroySession(c).catch(() => undefined);
  return c.json({ revoked: r.length });
});

settingsRoutes.delete("/security/sessions/:prefix", async (c) => {
  const user = requireUser(c);
  const prefix = z.string().regex(/^[0-9a-f]{16}$/).parse(c.req.param("prefix"));
  const rows = await getDb().select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, user.id));
  const target = rows.find((r) => r.id.startsWith(prefix));
  if (!target) throw badRequest("Session not found");
  if (target.id === c.get("sessionId")) throw badRequest("Use Sign out to end the current session");
  await getDb().delete(sessions).where(and(eq(sessions.id, target.id), eq(sessions.userId, user.id));
  await logSecurityEvent(user.id, "session_revoked");
  return c.json({ ok: true });
});
