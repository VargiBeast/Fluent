import { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";

export const settingsRoutes = new Hono<AppEnv>();
