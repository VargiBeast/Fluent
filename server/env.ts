import { z } from "zod";

/**
 * Server configuration. Every external credential is optional so the app can boot and
 * report an honest "not configured" state instead of crashing or faking data.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(["auto", "require", "disable"]).default("auto"),
  TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MS_CLIENT_ID: z.string().optional(),
  MS_CLIENT_SECRET: z.string().optional(),
  AI_PROVIDER: z.enum(["google", "xai", "openai"]).optional(),
  AI_MODEL: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Test-only overrides (ignored in production)
  MAILIQ_TEST_GOOGLE_BASE: z.string().url().optional(),
  MAILIQ_TEST_AI_BASE: z.string().url().optional(),
  MAILIQ_TEST_MAIL_PORTS: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment configuration");
  }
  cached = parsed.data;
  return cached;
}

/** Clear the cached env (used by unit tests that mutate process.env). */
export function resetEnv(): void {
  cached = null;
}

/** True when NODE_ENV is production. Prefer this over reading process.env directly. */
export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

export function googleConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

export function microsoftConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.MS_CLIENT_ID && e.MS_CLIENT_SECRET);
}

/** Prefer secure cookies in production (or whenever APP_URL is https). */
export function secureCookies(): boolean {
  const e = getEnv();
  if (e.NODE_ENV === "production") return true;
  try {
    return new URL(e.APP_URL).protocol === "https:";
  } catch {
    return false;
  }
}

export function microsoftRedirectUri(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/api/auth/microsoft/callback`;
}

export function googleRedirectUri(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/api/auth/google/callback`;
}

/** Google OAuth redirect URI (alias used by google.ts and readiness). */
export function redirectUri(): string {
  return googleRedirectUri();
}

export interface GoogleEndpoints {
  authorize: string;
  token: string;
  revoke: string;
  jwks: string;
  issuers: string[];
  gmail: string;
}

export function googleEndpoints(): GoogleEndpoints {
  const e = getEnv();
  // Test override points the entire Google surface at the in-process fake.
  if (e.NODE_ENV !== "production" && e.MAILIQ_TEST_GOOGLE_BASE) {
    const base = e.MAILIQ_TEST_GOOGLE_BASE.replace(/\/$/, "");
    return {
      authorize: `${base}/o/oauth2/v2/auth`,
      token: `${base}/token`,
      revoke: `${base}/revoke`,
      jwks: `${base}/oauth2/v3/certs`,
      issuers: [`${base}`, "https://accounts.google.com", "accounts.google.com"],
      gmail: `${base}/gmail/v1`,
    };
  }
  return {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    jwks: "https://www.googleapis.com/oauth2/v3/certs",
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    gmail: "https://gmail.googleapis.com/gmail/v1",
  };
}

export interface MicrosoftEndpoints {
  authorize: string;
  token: string;
  graph: string;
}

export function microsoftEndpoints(): MicrosoftEndpoints {
  // Microsoft identity platform (common tenant). No test base override currently.
  return {
    authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    graph: "https://graph.microsoft.com/v1.0",
  };
}

type AiProvider = "google" | "xai" | "openai";

export function aiProvider(): AiProvider {
  const e = getEnv();
  if (e.AI_PROVIDER) {
    if (e.AI_PROVIDER === "google" || e.AI_PROVIDER === "xai" || e.AI_PROVIDER === "openai") {
      return e.AI_PROVIDER;
    }
    throw new Error(`Unknown AI_PROVIDER: ${e.AI_PROVIDER}`);
  }
  // Auto-select: Gemini first, then xAI, then OpenAI.
  if (e.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (e.XAI_API_KEY) return "xai";
  if (e.OPENAI_API_KEY) return "openai";
  return "google";
}

export function aiConfigured(): boolean {
  const provider = aiProvider();
  return Boolean(aiApiKey(provider));
}

export function aiApiKey(provider?: AiProvider): string | undefined {
  const p = provider ?? aiProvider();
  const e = getEnv();
  if (p === "google") return e.GOOGLE_GENERATIVE_AI_API_KEY || undefined;
  if (p === "xai") return e.XAI_API_KEY || undefined;
  if (p === "openai") return e.OPENAI_API_KEY || undefined;
  return undefined;
}

/** Optional base URL override for AI SDKs (test fakes). */
export function aiBaseUrl(): string | undefined {
  const e = getEnv();
  if (e.NODE_ENV !== "production" && e.MAILIQ_TEST_AI_BASE) {
    return e.MAILIQ_TEST_AI_BASE.replace(/\/$/, "");
  }
  return undefined;
}
