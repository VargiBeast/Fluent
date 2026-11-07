import { assertAllowedGmailRequest, assertSafePageToken } from "./guard";
import type { GmailThreadResource } from "./parse";

export type FetchLike = typeof fetch;

export class GmailHttpError extends Error {
  constructor(
    public status: number,
    public reason: "rate_limit" | "reauth" | "forbidden" | "transient" | "bad_response",
    message: string,
  ) {
    super(message);
    this.name = "GmailHttpError";
  }
}

export interface GmailClient {
  listThreads(input: {
    pageToken?: string;
    query?: string;
    labelIds?: string[];
    maxResults?: number;
  }): Promise<{ threadIds: string[]; nextPageToken?: string }>;
  getThread(threadId: string, format: "metadata" | "full"): Promise<GmailThreadResource>;
  modifyThread(threadId: string, body: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void>;
  trashThread(threadId: string): Promise<void>;
  modifyMessage(messageId: string, body: { addLabelIds?: string[]; removeLabelIds?: string[] }): Promise<void>;
}

const BASE = "https://gmail.googleapis.com";

export function createGmailClient(options: {
  fetchImpl: FetchLike;
  accessToken: string;
}): GmailClient {
  async function request(method: string, pathname: string, query?: URLSearchParams, body?: unknown): Promise<Response> {
    assertAllowedGmailRequest(method, pathname);
    const url = new URL(pathname, BASE);
    if (query) url.search = query.toString();
    const response = await options.fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw mapStatus(response.status);
    }
    return response;
  }

  return {
    async listThreads(input) {
      const max = Math.min(Math.max(input.maxResults ?? 20, 1), 25);
      const params = new URLSearchParams({ maxResults: String(max) });
      const pageToken = assertSafePageToken(input.pageToken);
      if (pageToken && !pageToken.startsWith("demo:")) params.set("pageToken", pageToken);
      if (input.query) params.set("q", input.query.slice(0, 256));
      for (const label of input.labelIds ?? []) params.append("labelIds", label);
      const response = await request("GET", "/gmail/v1/users/me/threads", params);
      const json = (await response.json()) as {
        threads?: Array<{ id?: string }>;
        nextPageToken?: string;
      };
      return {
        threadIds: (json.threads ?? []).map((thread) => thread.id).filter((id): id is string => Boolean(id)),
        nextPageToken: json.nextPageToken,
      };
    },
    async getThread(threadId, format) {
      if (!/^[\w-]+$/.test(threadId)) throw new GmailHttpError(400, "bad_response", "Invalid thread id");
      const params = new URLSearchParams({ format });
      if (format === "metadata") {
        for (const name of ["From", "To", "Cc", "Subject", "Date"]) {
          params.append("metadataHeaders", name);
        }
      }
      const response = await request("GET", `/gmail/v1/users/me/threads/${threadId}`, params);
      return (await response.json()) as GmailThreadResource;
    },
    async modifyThread(threadId, body) {
      await request("POST", `/gmail/v1/users/me/threads/${threadId}/modify`, undefined, body);
    },
    async trashThread(threadId) {
      await request("POST", `/gmail/v1/users/me/threads/${threadId}/trash`);
    },
    async modifyMessage(messageId, body) {
      if (!/^[\w-]+$/.test(messageId)) throw new GmailHttpError(400, "bad_response", "Invalid message id");
      await request("POST", `/gmail/v1/users/me/messages/${messageId}/modify`, undefined, body);
    },
  };
}

function mapStatus(status: number): GmailHttpError {
  if (status === 401) return new GmailHttpError(status, "reauth", "Gmail rejected the access token");
  if (status === 403) return new GmailHttpError(status, "forbidden", "Gmail refused this mailbox request");
  if (status === 429) return new GmailHttpError(status, "rate_limit", "Gmail rate limit reached");
  if (status >= 500) return new GmailHttpError(status, "transient", "Gmail is temporarily unavailable");
  return new GmailHttpError(status, "bad_response", "Gmail returned an unexpected response");
}

export async function exchangeAuthCode(options: {
  fetchImpl: FetchLike;
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<{ accessToken: string; refreshToken: string | null; expiresIn: number; scope: string }> {
  const response = await options.fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: "authorization_code",
      code_verifier: options.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new GmailHttpError(response.status, response.status === 401 ? "reauth" : "bad_response", "Google token exchange failed");
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!json.access_token) throw new GmailHttpError(502, "bad_response", "Google token response was incomplete");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? 3600,
    scope: json.scope ?? "",
  };
}

export async function refreshAccessToken(options: {
  fetchImpl: FetchLike;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await options.fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      refresh_token: options.refreshToken,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new GmailHttpError(response.status, "reauth", "Google refresh failed");
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GmailHttpError(502, "bad_response", "Google refresh response was incomplete");
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 };
}

export async function revokeToken(fetchImpl: FetchLike, token: string): Promise<boolean> {
  const response = await fetchImpl("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return response.ok;
}

export async function fetchUserInfo(fetchImpl: FetchLike, accessToken: string): Promise<{
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}> {
  const response = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!response.ok) throw new GmailHttpError(response.status, "reauth", "Google userinfo failed");
  const json = (await response.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!json.sub || !json.email) {
    throw new GmailHttpError(502, "bad_response", "Google account did not include an email");
  }
  return {
    sub: json.sub,
    email: json.email,
    emailVerified: json.email_verified !== false,
    name: json.name ?? null,
    picture: json.picture ?? null,
  };
}

export function googleAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
  prompt?: "consent" | "select_account";
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", options.scopes.join(" "));
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  if (options.prompt) url.searchParams.set("prompt", options.prompt);
  return url.toString();
}
