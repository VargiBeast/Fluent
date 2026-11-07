import { Router, type Request, type Response } from "express";
import { loadConfig, setupStatus } from "../config";
import { HttpError, blocked } from "../errors";
import { clearOAuthCookie, clearSessionCookies, readCookie, setOAuthCookie, setSessionCookies } from "../http/cookies";
import { requestFetch } from "../http/security";
import {
  consumeOAuthState,
  loginWithGoogleCode,
  readSession,
  revokeSession,
  startDemoSession,
  startOAuth,
} from "../services/auth";

const router = Router();

router.get("/auth/config", (_req, res) => {
  const config = loadConfig();
  res.json(setupStatus(config));
});

router.get("/auth/session", async (req, res) => {
  if (req.authFailure === "expired") {
    throw new HttpError(401, "SESSION_EXPIRED", "The session expired. Sign in again.");
  }
  if (req.authFailure === "revoked") {
    throw new HttpError(401, "SESSION_REVOKED", "This session was signed out.");
  }
  if (!req.fluent) {
    res.json({ authenticated: false });
    return;
  }
  res.json({
    authenticated: true,
    user: {
      id: req.fluent.userId,
      email: req.fluent.email,
      displayName: req.fluent.displayName,
      isDemo: req.fluent.isDemo,
      onboarded: req.fluent.onboarded,
    },
  });
});

router.get("/auth/google/start", async (req, res) => {
  const config = loadConfig();
  const started = await startOAuth({
    config,
    purpose: "login",
    returnTo: typeof req.query.returnTo === "string" ? req.query.returnTo : undefined,
  });
  setOAuthCookie(res, config, started.state);
  res.redirect(started.url);
});

router.get("/auth/google/callback", async (req, res) => {
  const config = loadConfig();
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!state || !code) throw new HttpError(400, "OAUTH_STATE", "Google did not return a complete sign-in response");
  const consumed = await consumeOAuthState({
    config,
    purpose: "login",
    state,
    cookieState: readCookie(req.cookies ?? {}, "oauth"),
  });
  clearOAuthCookie(res, config);
  const session = await loginWithGoogleCode({
    config,
    code,
    verifier: consumed.verifier,
    fetchImpl: requestFetch(req),
    userAgent: req.get("user-agent"),
  });
  setSessionCookies(res, config, session.token, session.csrf);
  res.redirect(`${config.appOrigin}${consumed.returnTo || "/onboarding"}`);
});

router.post("/auth/demo", async (req, res) => {
  const config = loadConfig();
  if (!config.demoMode) {
    throw blocked([], "Demo mode is off. Set FLUENT_DEMO_MODE=true outside production, or configure Google sign-in.");
  }
  const session = await startDemoSession(req.get("user-agent"));
  setSessionCookies(res, config, session.token, session.csrf);
  res.json({
    authenticated: true,
    demo: true,
    label: "Synthetic demo session. This is not a Google account and not a real mailbox.",
    user: session.user,
  });
});

router.post("/auth/logout", async (req, res) => {
  const config = loadConfig();
  if (req.fluent) await revokeSession(req.fluent.userId, req.fluent.sessionId);
  clearSessionCookies(res, config);
  res.json({ authenticated: false });
});

export async function attachSession(req: Request, _res: Response): Promise<void> {
  const token = readCookie(req.cookies ?? {}, "session");
  if (!token) return;
  const session = await readSession(token);
  if (session.status === "expired") req.authFailure = "expired";
  if (session.status === "revoked") req.authFailure = "revoked";
  if (session.status !== "ok") return;
  req.fluent = {
    userId: session.user.id,
    sessionId: session.sessionId,
    email: session.user.email,
    displayName: session.user.displayName,
    isDemo: session.user.isDemo,
    onboarded: session.user.onboarded,
    csrfHash: session.csrfHash,
  };
}

export default router;
