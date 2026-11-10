export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const diffDays = (now.getTime() - d.getTime()) / 86400_000;
  if (diffDays < 6) return d.toLocaleDateString(undefined, { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
