import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler, type Express } from "express";
import { ZodError } from "zod";
import { loadConfig } from "./config";
import { HttpError } from "./errors";
import { GmailHttpError } from "./gmail/client";
import { GmailPathError } from "./gmail/guard";
import { clientIp, requireOrigin, securityHeaders } from "./http/security";
import { createRateLimiter } from "./http/rate-limit";
import { logger } from "./lib/logger";
import pinoHttp from "pino-http";
import healthRouter from "./routes/health";
import authRouter, { attachSession } from "./routes/auth";
import mailboxRouter from "./routes/mailbox";

const app: Express = express();
const config = loadConfig();

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(securityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === config.appOrigin) {
        callback(null, origin ?? true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "200kb" }));
app.use(requireOrigin(config));
app.use(
  "/api",
  createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.FLUENT_RATE_LIMIT_MAX ?? 180),
    key: (req) => req.fluent?.userId ?? clientIp(req),
  }),
);
app.use(async (req, _res, next) => {
  try {
    await attachSession(req, _res);
    next();
  } catch (error) {
    next(error);
  }
});

app.use("/api", healthRouter);
app.use("/api", authRouter);
app.use("/api", mailboxRouter);

const onError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.missing ? { missing: error.missing } : {}) },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "The request is not valid" } });
    return;
  }
  if (error instanceof GmailPathError) {
    res.status(400).json({ error: { code: "GMAIL_PATH", message: error.message } });
    return;
  }
  if (error instanceof GmailHttpError) {
    const status = error.reason === "rate_limit" ? 429 : error.reason === "reauth" ? 401 : 502;
    res.status(status).json({ error: { code: error.reason.toUpperCase(), message: error.message } });
    return;
  }
  if (error instanceof Error && error.message === "DATABASE_NOT_CONFIGURED") {
    res.status(503).json({
      error: { code: "BLOCKED", message: "Database is not configured", missing: ["DATABASE_URL"] },
    });
    return;
  }
  logger.error({ name: error instanceof Error ? error.name : "Error" }, "request failed");
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong." } });
};

app.use(onError);

export default app;
