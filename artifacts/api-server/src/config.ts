export type AiMode = "live" | "mock" | "blocked";

export interface AppConfig {
  nodeEnv: string;
  appOrigin: string;
  demoMode: boolean;
  googleClientId: string | null;
  googleClientSecret: string | null;
  tokenEncryptionKey: string | null;
  aiApiKey: string | null;
  aiBaseUrl: string;
  aiModel: string;
  aiMode: AiMode;
  loginRedirectUri: string;
  gmailRedirectUri: string;
}

export interface SetupStatus {
  googleLogin: "ready" | "blocked";
  gmailConnect: "ready" | "blocked";
  encryption: "ready" | "blocked";
  ai: AiMode;
  demoMode: boolean;
  missing: string[];
  gmailScope: {
    scope: "https://www.googleapis.com/auth/gmail.modify";
    includesSend: true;
    includesPermanentDelete: false;
    applicationSendEnabled: false;
    applicationDraftWriteEnabled: false;
    applicationPermanentDeleteEnabled: false;
  };
}

const DEFAULT_ORIGIN = "http://localhost:20126";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const appOrigin = normalizeOrigin(env.APP_ORIGIN ?? DEFAULT_ORIGIN);
  const demoRequested = env.FLUENT_DEMO_MODE === "true";
  const demoMode = demoRequested && nodeEnv !== "production";
  const googleClientId = emptyToNull(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = emptyToNull(env.GOOGLE_CLIENT_SECRET);
  const tokenEncryptionKey = emptyToNull(env.TOKEN_ENCRYPTION_KEY);
  const aiApiKey = emptyToNull(env.AI_API_KEY);
  const requested = env.AI_PROVIDER?.trim().toLowerCase();
  let aiMode: AiMode = "blocked";
  if (requested === "mock") aiMode = "mock";
  else if (aiApiKey && requested !== "blocked") aiMode = "live";
  return {
    nodeEnv,
    appOrigin,
    demoMode,
    googleClientId,
    googleClientSecret,
    tokenEncryptionKey,
    aiApiKey,
    aiBaseUrl: (env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    aiModel: env.AI_MODEL ?? "gpt-4o-mini",
    aiMode,
    loginRedirectUri: `${appOrigin}/api/auth/google/callback`,
    gmailRedirectUri: `${appOrigin}/api/gmail/connect/callback`,
  };
}

export function setupStatus(config: AppConfig): SetupStatus {
  const missing: string[] = [];
  if (!config.googleClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!config.googleClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!config.tokenEncryptionKey) missing.push("TOKEN_ENCRYPTION_KEY");
  const googleReady = Boolean(
    config.googleClientId && config.googleClientSecret && config.tokenEncryptionKey,
  );
  if (config.aiMode === "blocked") missing.push("AI_API_KEY");
  return {
    googleLogin: googleReady ? "ready" : "blocked",
    gmailConnect: googleReady ? "ready" : "blocked",
    encryption: config.tokenEncryptionKey ? "ready" : "blocked",
    ai: config.aiMode,
    demoMode: config.demoMode,
    missing,
    gmailScope: {
      scope: "https://www.googleapis.com/auth/gmail.modify",
      includesSend: true,
      includesPermanentDelete: false,
      applicationSendEnabled: false,
      applicationDraftWriteEnabled: false,
      applicationPermanentDeleteEnabled: false,
    },
  };
}

export function assertSafeReturnTo(value: string | undefined): string {
  const allowed = new Set(["/", "/onboarding", "/inbox", "/settings", "/overview"]);
  if (value && allowed.has(value)) return value;
  return "/onboarding";
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN must be an absolute origin such as http://localhost:20126");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("APP_ORIGIN must use http or https");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APP_ORIGIN must be an origin without a path, query, or credentials");
  }
  return url.origin;
}

function emptyToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
