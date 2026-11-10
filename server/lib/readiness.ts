import { generateText } from "ai";
import { getModel } from "../ai/core.js";
import { aiConfigured, getEnv, googleEndpoints, redirectUri } from "../env.js";
import { logger } from "../logger.js";

export type CheckResult = "ok" | "error" | "not_configured" | "invalid_client";

/**
 * Verifies the Google OAuth client without a user: exchanging a bogus code makes Google answer
 * `invalid_grant` when the client id/secret are valid, and `invalid_client` when they are not.
 */
export async function checkGoogleClient(): Promise<CheckResult> {
  const e = getEnv();
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET) return "not_configured";
  try {
    const res = await fetch(googleEndpoints().token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: e.GOOGLE_CLIENT_ID,
        client_secret: e.GOOGLE_CLIENT_SECRET,
        code: "fluent-readiness-probe",
        grant_type: "authorization_code",
        redirect_uri: redirectUri(),
      }),
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_grant") return "ok";
    if (body.error === "invalid_client" || body.error === "unauthorized_client") return "invalid_client";
    logger.warn({ status: res.status, error: body.error }, "readiness_google_unexpected");
    return "error";
  } catch (err) {
    logger.warn({ err: (err as Error).name }, "readiness_google_error");
    return "error";
  }
}

/** Sends a tiny synthetic prompt to the configured AI provider. The model output is discarded. */
export async function checkAi(): Promise<CheckResult> {
  if (!aiConfigured()) return "not_configured";
  try {
    await generateText({
      model: getModel(),
      prompt: "Reply with the single word OK.",
      maxOutputTokens: 16,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(15_000),
    });
    return "ok";
  } catch (err) {
    logger.warn({ err: (err as Error).name, status: (err as { statusCode?: number }).statusCode }, "readiness_ai_error");
    return "error";
  }
}

let cache: { at: number; value: { ai: CheckResult; googleClient: CheckResult } } | undefined;
const CACHE_MS = 60_000;

/** Deep external checks, cached for a minute so repeated calls never fan out to providers. */
export async function deepChecks(now = Date.now()): Promise<{ ai: CheckResult; googleClient: CheckResult; cached: boolean }> {
  if (cache && now - cache.at < CACHE_MS) return { ...cache.value, cached: true };
  const [ai, googleClient] = await Promise.all([checkAi(), checkGoogleClient()]);
  cache = { at: now, value: { ai, googleClient } };
  return { ai, googleClient, cached: false };
}

export function resetDeepCheckCache(): void {
  cache = undefined;
}
