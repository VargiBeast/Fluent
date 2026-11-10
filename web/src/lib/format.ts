import { prefs } from "./prefs";

const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: prefs.timeZone }).format(d);

export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = dayKey(d) === dayKey(now);
  if (sameDay) return d.toLocaleTimeString(prefs.locale, { hour: "2-digit", minute: "2-digit", timeZone: prefs.timeZone });
  const diffDays = (now.getTime() - d.getTime()) / 86400_000;
  if (diffDays < 6) return d.toLocaleDateString(prefs.locale, { weekday: "short", timeZone: prefs.timeZone });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(prefs.locale, { month: "short", day: "numeric", timeZone: prefs.timeZone });
  return d.toLocaleDateString(prefs.locale, { year: "numeric", month: "short", day: "numeric", timeZone: prefs.timeZone });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(prefs.locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: prefs.timeZone });
}

export function relative(iso: string, now = new Date()): string {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export type DateGroup = "Today" | "Yesterday" | "This week" | "Earlier this month" | "Older";

export function dateGroup(iso: string, now = new Date()): DateGroup {
  const d = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const t = d.getTime();
  if (t >= start.getTime()) return "Today";
  if (t >= start.getTime() - 86400_000) return "Yesterday";
  if (t >= start.getTime() - 6 * 86400_000) return "This week";
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return "Earlier this month";
  return "Older";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function displayName(a: { name: string; email: string }): string {
  return a.name && a.name !== a.email ? a.name : a.email.split("@")[0] ?? a.email;
}
