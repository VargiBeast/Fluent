import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppEnv } from "../lib/context.js";
import { decrypt, encrypt, pkceChallenge, randomToken, safeEqual } from "../crypto.js";
import { googleConfigured, secureCookies } from "../env.js";
import { buildAuthorizeUrl, exchangeCode, verifyIdToken } from "../auth/google.js";
import { createSession, destroySession, requireUser } from "../auth/session.js";
import { getOwnedAccount, listAccounts, logSecurityEvent, toPublicAccount, upsertAccount, upsertUser } from "../services/accounts.js";
import { getDb } from "../db/client.js";
import { userSettings } from "../db/schema.js";
import { rateLimit } from "../lib/rateLimit.js";
import { HttpError } from "../lib/errors.js";
import { logger } from "../logger.js";
import { parseSettings } from "../../shared/settings.js";

const OAUTH_COOKIE = "fluent_oauth";
const OAUTH_TTL_MS = 10 * 60 * 1000;

interface OAuthState {
  state: string;
  verifier: string;
  nonce: string;
  mode: "login" | "link";
  userId?: string;
  next: string;
  exp: number;
}

/** Only allow same-site relative paths as post-login destinations (no open redirects). */
export function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("://")) return "/app";
  return next.slice(0, 200);
}

const startQuery = z.object({
  mode: z.enum(["login", "link"]).default("login"),
  account: z.string().uuid().optional(),
  next: z.string().optional(),
});

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/session", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ user: null });
  const [accs, settingsRows] = await Promise.all([
    listAccounts(user.id),
    getDb().select().from(userSettings).where(eq(userSettings.userId, user.id)).limit(1),
  ]);
  return c.json({
    user,
    csrfToken: c.get("csrfToken"),
    onboarded: settingsRows[0]?.onboarded ?? false,
    settings: parseSettings(settingsRows[0]?.data),
    accounts: accs.map(toPublicAccount),
  });
});

authRoutes.get("/google/start", rateLimit("auth", 30), async (c) => {
  if (!googleConfigured()) return c.redirect("/?error=not_configured", 302);
  const q = startQuery.parse(c.req.query());
  let loginHint: string | undefined;
  let userId: string | undefined;
  if (q.mode === "link") {
    const user = c.get("user");
    if (!user) return c.redirect("/?error=session_required", 302);
    userId = user.id;
    if (q.account) loginHint = (await getOwnedAccount(user.id, q.account)).email;
  }
  const st: OAuthState = {
    state: randomToken(24),
    verifier: randomToken(48),
    nonce: randomToken(16),
    mode: q.mode,
    userId,
    next: safeNext(q.next),
    exp: Date.now() + OAUTH_TTL_MS,
  };
  setCookie(c, OAUTH_COOKIE, encrypt(JSON.stringify(st), "oauth"), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "Lax",
    path: "/api/auth",
    maxAge: OAUTH_TTL_MS / 1000,
  });
  return c.redirect(buildAuthorizeUrl({ state: st.state, codeChallenge: pkceChallenge(st.verifier), nonce: st.nonce, loginHint }), 302);
});

authRoutes.get("/google/callback", rateLimit("auth", 30), async (c) => {
  const raw = getCookie(c, OAUTH_COOKIE);
  deleteCookie(c, OAUTH_COOKIE, { path: "/api/auth", secure: secureCookies() });
  const fail = (code: string) => c.redirect(`/?error=${encodeURIComponent(code)}`, 302);
  if (!raw) return fail("state_missing");
  let st: OAuthState;
  try {
    st = JSON.parse(decrypt(raw, "oauth")) as OAuthState;
  } catch {
    return fail("state_invalid");
  }
  const q = c.req.query();
  if (!q.state || !safeEqual(q.state, st.state) || st.exp < Date.now()) return fail("state_invalid");
  if (q.error) return fail(q.error === "access_denied" ? "access_denied" : "oauth_error");
  if (!q.code || q.code.length > 2048) return fail("code_missing");

  try {
    const tokens = await exchangeCode(q.code, st.verifier);
    if (!tokens.id_token) return fail("identity_missing");
    const identity = await verifyIdToken(tokens.id_token, st.nonce);

    if (st.mode === "link") {
      const user = c.get("user");
      if (!user || user.id !== st.userId) return fail("session_mismatch");
      const acc = await upsertAccount(user.id, identity, tokens);
      await logSecurityEvent(user.id, "account_connected", identity.email);
      return c.redirect(acc.status === "active" ? "/app/settings/accounts?connected=1" : "/app/settings/accounts?error=insufficient_scopes", 302);
    }

    const { id: userId } = await upsertUser(identity);
    const acc = await upsertAccount(userId, identity, tokens);
    if (c.get("sessionId")) await destroySession(c);
    await createSession(c, userId);
    await logSecurityEvent(userId, "sign_in", c.req.header("user-agent")?.slice(0, 120) ?? "");
    const settings = await getDb().select({ onboarded: userSettings.onboarded }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
    if (acc.status !== "active") return c.redirect("/app/onboarding?error=insufficient_scopes", 302);
    return c.redirect(settings[0]?.onboarded ? st.next : "/app/onboarding", 302);
  } catch (err) {
    const code = err instanceof HttpError ? err.code : "signin_failed";
    logger.warn({ code, err: err instanceof Error ? err.message : "unknown" }, "oauth_callback_failed");
    return fail(code);
  }
});

authRoutes.post("/logout", async (c) => {
  const user = requireUser(c);
  await logSecurityEvent(user.id, "sign_out");
  await destroySession(c);
  return c.json({ ok: true });
});
