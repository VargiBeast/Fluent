import type { CookieOptions, Response } from "express";
import type { AppConfig } from "../config";

const SESSION = "fluent_session";
const CSRF = "fluent_csrf";
const OAUTH = "fluent_oauth";

function base(config: AppConfig, maxAge: number, httpOnly: boolean): CookieOptions {
  return {
    httpOnly,
    sameSite: "lax",
    secure: config.nodeEnv === "production",
    path: "/",
    maxAge,
  };
}

export function setSessionCookies(
  res: Response,
  config: AppConfig,
  token: string,
  csrf: string,
): void {
  res.cookie(SESSION, token, base(config, 14 * 24 * 60 * 60 * 1000, true));
  res.cookie(CSRF, csrf, base(config, 14 * 24 * 60 * 60 * 1000, false));
}

export function clearSessionCookies(res: Response, config: AppConfig): void {
  res.clearCookie(SESSION, base(config, 0, true));
  res.clearCookie(CSRF, base(config, 0, false));
}

export function setOAuthCookie(res: Response, config: AppConfig, state: string): void {
  res.cookie(OAUTH, state, base(config, 10 * 60 * 1000, true));
}

export function clearOAuthCookie(res: Response, config: AppConfig): void {
  res.clearCookie(OAUTH, base(config, 0, true));
}

export function readCookie(reqCookies: Record<string, string | undefined>, name: "session" | "csrf" | "oauth"): string | undefined {
  const key = name === "session" ? SESSION : name === "csrf" ? CSRF : OAUTH;
  const value = reqCookies[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
