import { handle } from "hono/vercel";
import { createApp } from "../server/app.js";

// Single Vercel Function serving every /api/* route (see vercel.json rewrite).
const app = createApp();
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
