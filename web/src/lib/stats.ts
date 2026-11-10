/** Formatting helpers for the inbox stats page. */
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 24) return h < 10 ? `${h.toFixed(1).replace(/\.0$/, "")} h` : `${Math.round(h)} h`;
  const d = h / 24;
  return d < 10 ? `${d.toFixed(1).replace(/\.0$/, "")} days` : `${Math.round(d)} days`;
}

/** Bar label for a volume bucket: "Nov 10" for days, "Week of Nov 9" for weeks (UTC date strings). */
export function bucketLabel(start: string, granularity: "day" | "week", long = false): string {
  const d = new Date(`${start}T00:00:00Z`);
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  if (granularity === "week") return long ? `Week of ${md}` : md;
  return long ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : md;
}

/** Nice ceiling for a chart axis (1, 2, 5 × 10^n). */
export function niceMax(n: number): number {
  if (n <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

export function hourLabel(h: number): string {
  return new Date(Date.UTC(2020, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
}
