import { createRemoteJWKSet, jwtVerify } from "jose";
import { getEnv, googleEndpoints, redirectUri } from "../env.js";
import { HttpError } from "../lib/errors.js";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.settings.basic",
];
export const LOGIN_SCOPES = ["openid", "email", "profile", ...GMAIL_SCOPES];
export const REQUIRED_GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export function buildAuthorizeUrl(p: { state: string; codeChallenge: string; nonce: string; loginHint?: string }): string {
  const e = getEnv();
  const url = new URL(googleEndpoints().authorize);
  url.searchParams.set("client_id", e.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", LOGIN_SCOPES.join(" "));
  url.searchParams.set("state", p.state);
  url.searchParams.set("nonce", p.nonce);
  url.searchParams.set("code_challenge", p.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent select_account");
  if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type: string;
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(googleEndpoints().token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let code = "token_error";
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error === "invalid_grant") code = "invalid_grant";
    } catch { /* ignore */ }
    throw new HttpError(code === "invalid_grant" ? 401 : 502, code, "Google rejected the authorization. Please reconnect your account.");
  }
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(code: string, codeVerifier: string): Promise<TokenResponse> {
  const e = getEnv();
  return tokenRequest(new URLSearchParams({
    code,
    client_id: e.GOOGLE_CLIENT_ID ?? "",
    client_secret: e.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  }));
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const e = getEnv();
  return tokenRequest(new URLSearchParams({
    refresh_token: refreshToken,
    client_id: e.GOOGLE_CLIENT_ID ?? "",
    client_secret: e.GOOGLE_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
  }));
}

export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(googleEndpoints().revoke, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
  const ep = googleEndpoints();
  if (!jwks || jwks.url !== ep.jwks) jwks = { url: ep.jwks, set: createRemoteJWKSet(new URL(ep.jwks)) };
  const { payload } = await jwtVerify(idToken, jwks.set, {
    issuer: ep.issuers,
    audience: getEnv().GOOGLE_CLIENT_ID ?? "",
    clockTolerance: 30,
  });
  if (payload.nonce !== expectedNonce) throw new HttpError(400, "invalid_nonce", "Sign-in could not be verified.");
  if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
    throw new HttpError(400, "invalid_identity", "Google did not return an email address.");
  }
  if (payload.email_verified !== true) {
    throw new HttpError(403, "email_unverified", "Your Google email address is not verified.");
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : payload.email,
    picture: typeof payload.picture === "string" ? payload.picture : null,
  };
}
