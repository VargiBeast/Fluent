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
  AI_PROVIDER: z.enum(["xai", "openai"]).default("xai"),
  AI_MODEL: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // Test-only endpoint overrides. Ignored when NODE_ENV=production.
  FLUENT_TEST_GOOGLE_BASE: z.string().url().optional(),
  FLUENT_TEST_AI_BASE: z.string().url().optional(),
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

export function aiConfigured(): boolean {
  const e = getEnv();
  return e.AI_PROVIDER === "xai" ? Boolean(e.XAI_API_KEY) : Boolean(e.OPENAI_API_KEY);
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
