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

export function googleConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
}

export function microsoftConfigured(): boolean {
  const e = getEnv();
  return Boolean(e.MS_CLIENT_ID && e.MS_CLIENT_SECRET);
}

export function microsoftRedirectUri(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/api/auth/microsoft/callback`;
}

export function googleRedirectUri(): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/api/auth/google/callback`;
}
