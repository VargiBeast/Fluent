import type { BeforeSendEvent } from "@vercel/analytics/react";

/**
 * Privacy filter for Vercel Web Analytics. Only coarse, allow-listed page paths ever leave the
 * browser: query strings and fragments (search terms, label names, account ids) are dropped,
 * thread URLs collapse to `/app/<folder>/thread`, and anything unrecognised becomes a generic path.
 * FLUENT sends no custom events.
 */
const PUBLIC = new Set(["/", "/privacy", "/terms"]);
const APP_SECTIONS = new Set([
  "inbox", "starred", "snoozed", "important", "sent", "drafts", "archive", "spam", "trash", "all",
  "search", "label", "overview", "settings", "onboarding",
]);

export function analyticsPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (PUBLIC.has(path)) return path;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "app") return "/not-found";
  if (parts.length === 1) return "/app";
  const section = parts[1]!;
  if (!APP_SECTIONS.has(section)) return "/app/other";
  if (parts.length === 2) return `/app/${section}`;
  if (section === "settings" && parts.length === 3 && /^[a-z-]{1,30}$/.test(parts[2]!)) return `/app/settings/${parts[2]}`;
  if (section !== "settings") return `/app/${section}/thread`;
  return "/app/other";
}

export function sanitizeAnalyticsUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${analyticsPath(u.pathname)}`;
  } catch {
    return "/";
  }
}

export function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  if (event.type !== "pageview") return null; // no custom events
  return { ...event, url: sanitizeAnalyticsUrl(event.url) };
}
