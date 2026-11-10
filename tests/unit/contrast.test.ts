import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guards the design tokens against contrast regressions (WCAG AA: 4.5:1 for body-size text).
const css = readFileSync(new URL("../../web/src/styles/index.css", import.meta.url), "utf8");
const block = (sel: string) => {
  const m = new RegExp(`${sel.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no ${sel} block`);
  return Object.fromEntries([...m[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1]!, x[2]!]));
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

describe.each([[":root"], [".dark"]])("tokens in %s", (sel) => {
  const t = block(sel);
  it.each([
    ["text", "surface"], ["text-2", "surface"], ["text-3", "surface"], ["text-3", "bg"],
    ["accent-fg", "accent"], ["accent-ink", "surface"], ["accent-ink", "bg"], ["danger", "surface"], ["success", "surface"], ["warning", "surface"],
  ])("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
});
