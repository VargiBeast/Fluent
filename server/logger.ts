import pino from "pino";

/**
 * Structured JSON logger. MailIQ never passes email bodies, subjects, snippets, tokens or
 * prompts to the logger; redaction below is a second line of defence.
 */
export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "password",
      "token",
      "access_token",
      "refresh_token",
      "client_secret",
    ],
    remove: true,
  },
});

/** Alias for modules that import { logger } */
export const logger = log;
