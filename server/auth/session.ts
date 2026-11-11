import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { and, eq, gt, lt } from "drizzle-orm";
import type { AppEnv, SessionUser } from "../lib/context.js";
import { getDb, hasDatabase } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { randomToken, sha256 } from "../crypto.js";
import { getEnv, secureCookies } from "../env.js";
import { unauthorized } from "../lib/errors.js";

export function sessionCookieName(): string {
  return secureCookies() ? "__Host-mailiq_session" : "mailiq_session";
}

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

export async function createSession(c: Context<AppEnv>, userId: string): Promise<void> {
  const token = randomToken(32);
  const ttlMs = getEnv().SESSION_TTL_DAYS * 86400_000;
  await getDb().insert(sessions).values({
    id: sha256(token),
    userId,
    csrfToken: randomToken(24),
    userAgent: (c.req.header("user-agent") ?? "").slice(0, 200),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  setCookie(c, sessionCookieName(), token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function destroySession(c: Context<AppEnv>): Promise<void> {
  const id = c.get("sessionId");
  if (id) await getDb().delete(sessions).where(eq(sessions.id, id));
  deleteCookie(c, sessionCookieName(), { path: "/", secure: secureCookies() });
}

export const sessionMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", undefined);
  c.set("sessionId", undefined);
  c.set("csrfToken", undefined);
  const token = getCookie(c, sessionCookieName());
  if (token && hasDatabase() && token.length < 200) {
    const id = sha256(token);
    const db = getDb();
    const rows = await db
      .select({ s: sessions, u: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
      .limit(1);
    const row = rows[0];
    if (row) {
      c.set("user", { id: row.u.id, email: row.u.email, name: row.u.name, picture: row.u.picture } satisfies SessionUser);
      c.set("sessionId", row.s.id);
      c.set("csrfToken", row.s.csrfToken);
      if (Date.now() - row.s.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
      }
    } else {
      deleteCookie(c, sessionCookieName(), { path: "/", secure: secureCookies() });
    }
  }
  await next();
};

export function requireUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  if (!user) throw unauthorized();
  return user;
}

export async function purgeExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
