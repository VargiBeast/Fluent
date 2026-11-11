import { getEnv, microsoftEndpoints, microsoftRedirectUri } from "../env.js";
import { HttpError } from "../lib/errors.js";

/** Delegated Microsoft Graph permissions MailIQ asks for. */
export const MS_SCOPES = ["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"];

export interface MsTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
}

export interface MsProfile { id: string; email: string; name: string }

export function buildMicrosoftAuthorizeUrl(p: { state: string; codeChallenge: string; loginHint?: string }): string {
  const url = new URL(microsoftEndpoints().authorize);
  url.searchParams.set("client_id", getEnv().MS_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", microsoftRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", MS_SCOPES.join(" "));
  url.searchParams.set("state", p.state);
  url.searchParams.set("code_challenge", p.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  if (p.loginHint) url.searchParams.set("login_hint", p.loginHint);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<MsTokenResponse> {
  const e = getEnv();
  const res = await fetch(microsoftEndpoints().token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: e.MS_CLIENT_ID ?? "", client_secret: e.MS_CLIENT_SECRET ?? "", scope: MS_SCOPES.join(" "), ...params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let code = "token_error";
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error === "invalid_grant") code = "invalid_grant";
    } catch { /* ignore */ }
    throw new HttpError(code === "invalid_grant" ? 401 : 502, code, "Microsoft rejected the authorization. Please reconnect your account.");
  }
  return (await res.json()) as MsTokenResponse;
}

export function exchangeMicrosoftCode(code: string, codeVerifier: string): Promise<MsTokenResponse> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: microsoftRedirectUri(), code_verifier: codeVerifier });
}

export function refreshMicrosoftToken(refreshToken: string): Promise<MsTokenResponse> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** The signed-in mailbox, from Graph /me (needs User.Read). */
export async function fetchMicrosoftProfile(accessToken: string): Promise<MsProfile> {
  const res = await fetch(`${microsoftEndpoints().graph}/me?$select=id,displayName,mail,userPrincipalName`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new HttpError(502, "identity_missing", "Couldn't read your Microsoft account profile.");
  const me = (await res.json()) as { id?: string; displayName?: string; mail?: string | null; userPrincipalName?: string };
  const email = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  if (!me.id || !/^[A-Za-z0-9._-]{1,128}$/.test(me.id) || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new HttpError(502, "identity_missing", "Your Microsoft account didn't return a mailbox address.");
  return { id: me.id, email, name: (me.displayName ?? "").slice(0, 120) };
}
