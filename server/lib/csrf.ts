import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./context.js";
import { safeEqual } from "../crypto.js";
import { getEnv } from "../env.js";
import { forbidden } from "./errors.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for authenticated mutations:
 * 1) SameSite=Lax session cookie, 2) Origin/Referer must match APP_URL,
 * 3) synchronizer token (X-CSRF-Token) bound to the server-side session.
 */
export const csrfMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE.has(c.req.method)) return next();
  const origin = c.req.header("origin") ?? refererOrigin(c.req.header("referer"));
  const allowed = new URL(getEnv().APP_URL).origin;
  if (!origin || origin !== allowed) throw forbidden("Cross-site request blocked", "csrf");
  const expected = c.get("csrfToken");
  if (expected) {
    const provided = c.req.header("x-csrf-token") ?? "";
    if (!safeEqual(provided, expected)) throw forbidden("Missing or invalid CSRF token", "csrf");
  }
  return next();
};

function refererOrigin(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  try {
    return new URL(ref).origin;
  } catch {
    return undefined;
  }
}
