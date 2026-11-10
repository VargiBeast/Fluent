import { z } from "zod";

/**
 * Server configuration. Every external credential is optional so the app can boot and
 * report an honest "not configured" state instead of crashing or faking data.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: z.enum(["require", "disable", "auto"]).default("auto"),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Empty means "pick automatically" (see aiProvider()).
  AI_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["google", "xai", "openai"]).optional()),
  AI_MODEL: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // Test-only endpoint overrides. Ignored when NODE_ENV=production.
  FLUENT_TEST_GOOGLE_BASE: z.string().url().optional(),
  FLUENT_TEST_AI_BASE: z.string().url().optional(),
  /** Routes *.fluent.test IMAP/SMTP hosts to plaintext fakes on 127.0.0.1, e.g. "993=14993,465=14465". Ignored when NODE_ENV=production. */
  FLUENT_TEST_MAIL_PORTS: z.string().regex(/^\d+=\d+(,\d+=\d+)*$/).optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

/** For tests: re-read process.env. */
export function resetEnv(): void {
  cached = undefined;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}

export function googleConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.TOKEN_ENCRYPTION_KEY && e.DATABASE_URL);
}

export type AiProvider = "google" | "xai" | "openai";

/**
 * The AI provider in use. An explicit AI_PROVIDER wins; otherwise the first provider with a key,
 * preferring Google Gemini, then xAI, then OpenAI. With no keys at all it reports "google".
 */
export function aiProvider(): AiProvider {
  const e = getEnv();
  if (e.AI_PROVIDER) return e.AI_PROVIDER;
  if (e.GOOGLE_GENERATIVE_AI_API_KEY) return "google";
  if (e.XAI_API_KEY) return "xai";
  if (e.OPENAI_API_KEY) return "openai";
  return "google";
}

export function aiApiKey(provider: AiProvider = aiProvider()): string | undefined {
  const e = getEnv();
  const key = provider === "google" ? e.GOOGLE_GENERATIVE_AI_API_KEY : provider === "xai" ? e.XAI_API_KEY : e.OPENAI_API_KEY;
  return key || undefined;
}

export function aiConfigured(): boolean {
  return Boolean(aiApiKey());
}

export function secureCookies(): boolean {
  return getEnv().APP_URL.startsWith("https://");
}

/** Endpoint bases. Overrides are honoured only outside production (for HTTP-level fakes). */
export function googleEndpoints() {
  const e = getEnv();
  const base = !isProduction() && e.FLUENT_TEST_GOOGLE_BASE ? e.FLUENT_TEST_GOOGLE_BASE.replace(/\/$/, "") : undefined;
  return {
    authorize: base ? `${base}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
    token: base ? `${base}/token` : "https://oauth2.googleapis.com/token",
    revoke: base ? `${base}/revoke` : "https://oauth2.googleapis.com/revoke",
    jwks: base ? `${base}/oauth2/v3/certs` : "https://www.googleapis.com/oauth2/v3/certs",
    issuers: base ? [base] : ["https://accounts.google.com", "accounts.google.com"],
    gmail: base ? `${base}/gmail/v1/users/me` : "https://gmail.googleapis.com/gmail/v1/users/me",
  };
}

export function aiBaseUrl(): string | undefined {
  const e = getEnv();
  return !isProduction() && e.FLUENT_TEST_AI_BASE ? e.FLUENT_TEST_AI_BASE : undefined;
}

export function redirectUri(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/api/auth/google/callback`;
}
