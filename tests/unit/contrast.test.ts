import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCENTS } from "../../shared/settings";

// Guards the design tokens against contrast regressions (WCAG AA: 4.5:1 for body-size text),
// for both themes and every accent colour.
const css = readFileSync(new URL("../../web/src/styles/index.css", import.meta.url), "utf8");
const block = (sel: string): Record<string, string> => {
  const m = new RegExp(`(?:^|\\n)${sel.replace(/[.[\]"]/g, "\\$&")} \\{([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`no ${sel} block`);
  return Object.fromEntries([...m[1]!.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6}|rgba\([^)]*\))/gi)].map((x) => [x[1]!, x[2]!]));
};
type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
/** Resolve a token to an opaque colour, compositing rgba() over `under`. */
const solid = (v: string, under: RGB): RGB => {
  if (v.startsWith("#")) return hex(v);
  const [r, g, b, a] = v.slice(5, -1).split(",").map(Number) as [number, number, number, number];
  return [r, g, b].map((c, i) => c * a + under[i]! * (1 - a)) as RGB;
};
const lum = (c: RGB) => {
  const l = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0]! + 0.7152 * l[1]! + 0.0722 * l[2]!;
};
const ratio = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

const themes: Array<[string, Record<string, string>]> = [];
for (const accent of ACCENTS) {
  const light = { ...block(":root"), ...(accent === "purple" ? {} : block(`[data-accent="${accent}"]`)) };
  const dark = { ...block(":root"), ...block(".dark"), ...(accent === "purple" ? {} : { ...block(`[data-accent="${accent}"]`), ...block(`.dark[data-accent="${accent}"]`) }) };
  themes.push([`light/${accent}`, light], [`dark/${accent}`, dark]);
}

const PAIRS: Array<[string, string]> = [
  ["text", "surface"], ["text-2", "surface"], ["text-3", "surface"], ["text-3", "bg"], ["text-3", "surface-2"],
  ["accent-fg", "accent"], ["accent-ink", "surface"], ["accent-ink", "bg"], ["accent-ink", "surface-2"],
  ["accent-ink", "accent-soft"], ["text-2", "accent-soft"], ["ai-title", "surface"],
  ["danger", "surface"], ["success", "surface"], ["warning", "surface"],
];

describe.each(themes)("tokens in %s", (_name, t) => {
  it.each(PAIRS)("%s on %s is at least 4.5:1", (fg, bg) => {
    const base = hex(t.surface!);
    const back = solid(t[bg]!, base); // translucent backgrounds (accent-soft) sit on a surface
    expect(ratio(solid(t[fg]!, back), back)).toBeGreaterThanOrEqual(4.5);
  });
});
