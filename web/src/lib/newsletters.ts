import type { NewsletterSender } from "@shared/unsubscribe";

/**
 * Senders you've unsubscribed from, remembered in this browser only (MailIQ stores nothing server-side for this),
 * so they move to the bottom with a badge until their old mail ages out of the scan.
 */
export type UnsubscribedMap = Record<string, string>;

export const senderKey = (s: Pick<NewsletterSender, "accountId" | "email">) => `${s.accountId}:${s.email}`;
const storageKey = (userId: string) => `fluent:unsubscribed:${userId}`;
const MAX_AGE_MS = 180 * 86400_000;

export function readUnsubscribed(userId: string, storage: Pick<Storage, "getItem"> = localStorage, now = Date.now()): UnsubscribedMap {
  try {
    const raw = JSON.parse(storage.getItem(storageKey(userId)) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: UnsubscribedMap = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string" && now - Date.parse(v) < MAX_AGE_MS) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeUnsubscribed(userId: string, map: UnsubscribedMap, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(storageKey(userId), JSON.stringify(map));
  } catch { /* storage full or disabled: the badge just won't persist */ }
}

/** Keeps the server's order (least opened first) but moves senders you've unsubscribed from to the end. */
export function orderSenders(senders: NewsletterSender[], unsubscribed: UnsubscribedMap): NewsletterSender[] {
  const active = senders.filter((s) => !unsubscribed[senderKey(s)]);
  const done = senders.filter((s) => unsubscribed[senderKey(s)]);
  return [...active, ...done];
}

export function openRateLabel(s: Pick<NewsletterSender, "read" | "total">): string {
  const pct = Math.round((s.read / Math.max(1, s.total)) * 100);
  return `Opened ${s.read} of ${s.total} (${pct}%)`;
}

export function openRateTone(rate: number): "low" | "mid" | "high" {
  return rate < 0.25 ? "low" : rate < 0.6 ? "mid" : "high";
}
