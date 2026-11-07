import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { loadConfig, setupStatus } from "../config";
import { resolveDbMode } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const config = loadConfig();
  const setup = setupStatus(config);
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json({
    ...data,
    service: "fluent",
    db: resolveDbMode(process.env),
    googleLogin: setup.googleLogin,
    gmailConnect: setup.gmailConnect,
    ai: setup.ai,
    demoMode: setup.demoMode,
    sendEnabled: false,
  });
});

export default router;
