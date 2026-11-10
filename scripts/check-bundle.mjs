/* global console, process */
// Fails when a JS chunk the browser loads before first paint, or the /app route chunk, exceeds the budget.
// Lazy chunks (the rich-text editor, settings, overview) are reported but not budgeted.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BUDGET = 300 * 1024;
const dir = "dist/assets";
const html = readFileSync("dist/index.html", "utf8");
const initial = new Set([...html.matchAll(/\/assets\/([^"]+\.js)/g)].map((m) => m[1]));
let failed = false;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
  const size = statSync(join(dir, f)).size;
  const budgeted = initial.has(f) || f.startsWith("AppRoutes-");
  const over = budgeted && size > BUDGET;
  if (over) failed = true;
  if (size > 20 * 1024 || over) console.log(`${over ? "OVER" : budgeted ? "ok  " : "lazy"} ${(size / 1024).toFixed(1).padStart(7)} kB  ${f}`);
}
if (failed) { console.error(`A first-load chunk is over ${BUDGET / 1024} kB.`); process.exit(1); }
