import pino from "pino";

/**
 * Structured JSON logger. FLUENT never passes email bodies, subjects, snippets, tokens or
 * prompts to the logger; redaction below is a second line of defence.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  base: { service: "fluent-api" },
  redact: {
    paths: [
      "*.authorization", "*.cookie", "*.password", "*.token", "*.accessToken", "*.refreshToken",
      "*.access_token", "*.refresh_token", "*.id_token", "*.body", "*.html", "*.text", "*.snippet",
      "*.subject", "*.prompt", "*.raw", "headers.authorization", "headers.cookie",
    ],
    censor: "[redacted]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
