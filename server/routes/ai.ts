import { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";

export const aiRoutes = new Hono<AppEnv>();
