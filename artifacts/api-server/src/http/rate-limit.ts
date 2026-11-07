import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors";

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  key: (req: Request) => string;
}) {
  const buckets = new Map<string, Bucket>();
  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = options.key(req);
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      res.setHeader("RateLimit-Limit", String(options.max));
      res.setHeader("RateLimit-Remaining", String(options.max - 1));
      next();
      return;
    }
    if (current.count >= options.max) {
      res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      next(new HttpError(429, "RATE_LIMITED", "Too many requests. Wait a moment and try again."));
      return;
    }
    current.count += 1;
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(Math.max(options.max - current.count, 0)));
    next();
  };
}
