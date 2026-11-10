import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { logger } from "./logger.js";

const port = Number(process.env.FLUENT_API_PORT ?? 8787);
serve({ fetch: createApp().fetch, port, hostname: "127.0.0.1" }, () => {
  logger.info({ port }, "FLUENT API listening");
});
