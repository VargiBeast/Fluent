import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { decrypt, encrypt } from "../crypto.js";
import { googleEndpoints } from "../env.js";
import { refreshAccessToken } from "../auth/google.js";
import { HttpError, notFound } from "../lib/errors.js";
import { logger } from "../logger.js";
import type { AccountRow } from "../services/accounts.js";

type Query = Record<string, string | number | boolean | string[] | undefined>;

/**
 * Thin Gmail REST client bound to one connected account. Handles access-token refresh,
 * retries with backoff for 429/5xx, and maps Gmail errors to safe client errors.
 * Response bodies are never logged.
 */
export class GmailClient {
  private token: string | null = null;

  constructor(public readonly account: AccountRow) {
    // Gmail-only features (send-as, filters, unsubscribe, stats, ...) fail clearly on other providers.
    if ((account.provider ?? "gmail") !== "gmail") throw new HttpError(400, "not_supported_for_provider", "This feature is only available for Gmail accounts.");
  }

  private aad(): string {
    return `${this.account.userId}:${this.account.googleSub}`;
  }

  private async accessToken(force = false): Promise<string> {
    const a = this.account;
    if (a.status === "insufficient_scopes") throw new HttpError(403, "insufficient_scopes", `FLUENT doesn't have Gmail access for ${a.email}. Reconnect and allow Gmail permissions.`);
    if (!force && this.token) return this.token;
    if (!force && a.accessTokenEnc && a.accessTokenExpiresAt && a.accessTokenExpiresAt.getTime() > Date.now() + 30_000) {
      this.token = decrypt(a.accessTokenEnc, "token", this.aad());
      return this.token;
    }
    if (!a.refreshTokenEnc) throw this.reauth();
    try {
      const t = await refreshAccessToken(decrypt(a.refreshTokenEnc, "token", this.aad()));
      const expiresAt = new Date(Date.now() + (t.expires_in - 60) * 1000);
      const enc = encrypt(t.access_token, "token", this.aad());
      await getDb().update(accounts).set({
        accessTokenEnc: enc,
        accessTokenExpiresAt: expiresAt,
        status: "active",
        updatedAt: new Date(),
        ...(t.refresh_token ? { refreshTokenEnc: encrypt(t.refresh_token, "token", this.aad()) } : {}),
      }).where(eq(accounts.id, a.id));
      a.accessTokenEnc = enc;
      a.accessTokenExpiresAt = expiresAt;
      this.token = t.access_token;
      return this.token;
    } catch (err) {
      if (err instanceof HttpError && err.code === "invalid_grant") {
        await getDb().update(accounts).set({ status: "needs_reauth", updatedAt: new Date() }).where(eq(accounts.id, a.id));
        a.status = "needs_reauth";
        throw this.reauth();
      }
      throw err;
    }
  }

  private reauth(): HttpError {
    return new HttpError(401, "account_reauth", `Access to ${this.account.email} expired or was revoked. Reconnect the account in Settings.`);
  }

  async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const url = new URL(`${googleEndpoints().gmail}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
    let attempt = 0;
    let forced = false;
    for (;;) {
      const token = await this.accessToken(forced);
      const res = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 401 && !forced) {
        forced = true;
        this.token = null;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        attempt++;
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt + Math.random() * 200));
        continue;
      }
      if (res.status === 204) return undefined as T;
      if (!res.ok) {
        let reason = "";
        try {
          const j = (await res.json()) as { error?: { message?: string; status?: string } };
          reason = j.error?.status ?? "";
        } catch { /* ignore */ }
        logger.warn({ gmailStatus: res.status, reason, method, path: path.replace(/\/[A-Za-z0-9_-]{6,}/g, "/:id") }, "gmail_error");
        if (res.status === 404) throw notFound("That email no longer exists in Gmail.");
        if (res.status === 401) throw this.reauth();
        if (res.status === 403) throw new HttpError(403, "gmail_forbidden", "Gmail refused this action for the connected account.");
        if (res.status === 429) throw new HttpError(429, "gmail_rate_limited", "Gmail is rate limiting requests. Please wait a moment.");
        if (res.status === 400 || res.status === 409) throw new HttpError(400, "gmail_bad_request", "Gmail rejected the request.");
        throw new HttpError(502, "gmail_unavailable", "Gmail is temporarily unavailable. Please try again.");
      }
      return (await res.json()) as T;
    }
  }
}

/** Run async tasks with bounded concurrency (keeps Gmail quota usage polite). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
