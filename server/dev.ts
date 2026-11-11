import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { log } from "./logger.js";

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  log.info({ port: info.port }, "MailIQ API listening");
});
