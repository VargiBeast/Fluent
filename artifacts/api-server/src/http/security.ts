import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config";
import { HttpError } from "../errors";

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Fluent-Api", "1");
  next();
}

export function requireOrigin(config: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }
    const origin = req.get("origin");
    if (origin !== config.appOrigin) {
      next(new HttpError(403, "ORIGIN_REJECTED", "This action must come from the FLUENT app"));
      return;
    }
    next();
  };
}

export function requestFetch(req: Request): typeof fetch {
  const injected = req.app.locals.fetchImpl as typeof fetch | undefined;
  return injected ?? fetch;
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
