import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { sendAsPatchSchema } from "../../shared/sendas.js";
import { logSecurityEvent } from "../services/accounts.js";
import { listSendAs, updateSendAs } from "../services/sendas.js";

/** Gmail send-as settings (display name + signature), via the gmail.settings.basic scope. */
export const sendAsRoutes = new Hono<AppEnv>();
sendAsRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});
sendAsRoutes.use("*", rateLimit("settings", 120));

sendAsRoutes.get("/", async (c) => {
  const user = requireUser(c);
  return c.json({ accounts: await listSendAs(user.id) });
});

sendAsRoutes.patch("/:accountId/:email", async (c) => {
  const user = requireUser(c);
  const accountId = z.string().uuid().parse(c.req.param("accountId"));
  const email = z.string().trim().toLowerCase().email().max(254).parse(c.req.param("email"));
  const patch = sendAsPatchSchema.parse(await c.req.json());
  const identity = await updateSendAs(user.id, accountId, email, patch);
  await logSecurityEvent(user.id, "gmail_sendas_updated", [patch.displayName !== undefined && "name", patch.signature !== undefined && "signature"].filter(Boolean).join(","));
  return c.json(identity);
});
