import { Hono } from "hono";
import type { AppEnv } from "../lib/context.js";

export const mailRoutes = new Hono<AppEnv>();
