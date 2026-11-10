import { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";
import { requireUser } from "../auth/session.js";
import { rateLimit } from "../lib/rateLimit.js";
import { IMAP_PRESETS, imapAccountInputSchema } from "../../shared/imap.js";
import { toPublicAccount } from "../services/accounts.js";
import { addImapAccount } from "../services/imapAccounts.js";

/** Non-Google mailboxes. Google accounts keep using /auth/google/start?mode=link. */
export const mailAccountRoutes = new Hono<AppEnv>();
mailAccountRoutes.use("*", async (c, next) => {
  requireUser(c);
  await next();
});

mailAccountRoutes.get("/providers", (c) => c.json({ imapPresets: IMAP_PRESETS }));

// Each attempt logs in to two servers, so keep it tight (also slows password guessing through FLUENT).
mailAccountRoutes.post("/imap", rateLimit("imap_connect", 5), async (c) => {
  const user = requireUser(c);
  const input = imapAccountInputSchema.parse(await c.req.json());
  const acc = await addImapAccount(user.id, input);
  return c.json({ account: toPublicAccount(acc) });
});
