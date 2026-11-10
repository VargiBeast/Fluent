import { GmailClient, mapLimit } from "../gmail/client.js";
import { header, parseAddress, type GmailThread } from "../gmail/parse.js";
import { HttpError } from "../lib/errors.js";
import type { InboxStats, ResponseBucket, StatsRange, TopSender, VolumeBucket } from "../../shared/stats.js";
import { resolveAccounts } from "./mail.js";

/** Conversations read per request across all accounts. Keeps a stats load within Gmail quota and ~10 s. */
export const STATS_THREAD_LIMIT = 400;
const DAY = 86400_000;

export interface StatMessage {
  threadId: string;
  /** Unique per account so threads from different accounts never mix. */
  accountId: string;
  at: number;
  fromEmail: string;
  fromName: string;
  fromMe: boolean;
}

export function safeTimeZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Calendar date (YYYY-MM-DD) and hour of `ms` in `timeZone`. */
function zoned(ms: number, timeZone: string): { date: string; hour: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** Monday of the week containing `date`. */
const weekStart = (date: string) => addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

const BUCKETS: Array<{ id: ResponseBucket["id"]; label: string; max: number }> = [
  { id: "lt1h", label: "< 1 hour", max: 60 },
  { id: "1to4h", label: "1–4 hours", max: 240 },
  { id: "4to24h", label: "4–24 hours", max: 1440 },
  { id: "1to3d", label: "1–3 days", max: 4320 },
  { id: "gt3d", label: "> 3 days", max: Infinity },
];

/**
 * Pure aggregation over message metadata (no content). Volume is bucketed by calendar day (weeks starting Monday
 * for 90 days) in the user's time zone. Response time = time from someone else's message to your first reply after
 * it in the same conversation, for replies sent inside the window.
 */
export function computeStats(messages: StatMessage[], opts: { days: StatsRange; now: number; timeZone: string }): Pick<InboxStats, "granularity" | "totals" | "volume" | "topSenders" | "response" | "byHour"> {
  const { days, now, timeZone } = opts;
  const since = now - days * DAY; // coarse pre-filter; the exact cut is the first calendar day below
  const granularity = days > 31 ? "week" : "day";
  const today = zoned(now, timeZone).date;
  const keyOf = (ms: number) => (granularity === "day" ? zoned(ms, timeZone).date : weekStart(zoned(ms, timeZone).date));
  // The window is the last `days` calendar days including today, in the user's zone.
  const firstDay = addDays(today, -(days - 1));
  const volume = new Map<string, VolumeBucket>();
  const step = granularity === "day" ? 1 : 7;
  for (let k = granularity === "day" ? firstDay : weekStart(firstDay); k <= today; k = addDays(k, step)) volume.set(k, { start: k, received: 0, sent: 0 });

  const senders = new Map<string, TopSender>();
  const byHour = new Array<number>(24).fill(0);
  let received = 0;
  let sent = 0;
  const inRange = (m: StatMessage) => m.at <= now && m.at >= since - DAY && zoned(m.at, timeZone).date >= firstDay;
  const inWindow = messages.filter(inRange);
  for (const m of inWindow) {
    const b = volume.get(keyOf(m.at));
    if (m.fromMe) {
      sent++;
      if (b) b.sent++;
      continue;
    }
    received++;
    if (b) b.received++;
    byHour[zoned(m.at, timeZone).hour]!++;
    const s = senders.get(m.fromEmail) ?? { email: m.fromEmail, name: m.fromName, count: 0 };
    s.count++;
    if (s.name === s.email && m.fromName !== m.fromEmail) s.name = m.fromName;
    senders.set(m.fromEmail, s);
  }

  const threads = new Map<string, StatMessage[]>();
  for (const m of messages) {
    const k = `${m.accountId}:${m.threadId}`;
    const arr = threads.get(k) ?? [];
    arr.push(m);
    threads.set(k, arr);
  }
  const deltas: number[] = [];
  for (const arr of threads.values()) {
    arr.sort((a, b) => a.at - b.at);
    let waitingSince: number | null = null;
    for (const m of arr) {
      if (!m.fromMe) {
        waitingSince ??= m.at;
      } else {
        if (waitingSince !== null && inRange(m)) deltas.push((m.at - waitingSince) / 60_000);
        waitingSince = null;
      }
    }
  }
  deltas.sort((a, b) => a - b);
  const avg = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : null;
  const mid = deltas.length ? (deltas.length % 2 ? deltas[(deltas.length - 1) / 2]! : (deltas[deltas.length / 2 - 1]! + deltas[deltas.length / 2]!) / 2) : null;
  const buckets: ResponseBucket[] = BUCKETS.map((b) => ({ id: b.id, label: b.label, count: 0 }));
  for (const d of deltas) buckets[BUCKETS.findIndex((b) => d < b.max)]!.count++;

  return {
    granularity,
    totals: { received, sent, conversations: new Set(inWindow.map((m) => `${m.accountId}:${m.threadId}`)).size },
    volume: [...volume.values()],
    topSenders: [...senders.values()].sort((a, b) => b.count - a.count || a.email.localeCompare(b.email)).slice(0, 10),
    response: { averageMinutes: avg === null ? null : Math.round(avg), medianMinutes: mid === null ? null : Math.round(mid), replies: deltas.length, buckets },
    byHour,
  };
}

/** Message metadata (From + date + labels) for the most recent conversations active in the window. */
async function collect(userId: string, account: string | undefined, days: StatsRange) {
  const accs = (await resolveAccounts(userId, account)).filter((a) => a.status === "active");
  const perAccount = accs.length ? Math.max(50, Math.floor(STATS_THREAD_LIMIT / accs.length)) : 0;
  const errors: InboxStats["errors"] = [];
  let truncated = false;
  let conversations = 0;
  const messages: StatMessage[] = [];
  await Promise.all(accs.map(async (a) => {
    try {
      const gm = new GmailClient(a);
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const r = await gm.request<{ threads?: Array<{ id: string }>; nextPageToken?: string }>("GET", "/threads", {
          query: { q: `newer_than:${days}d -in:chats -in:drafts`, maxResults: Math.min(100, perAccount - ids.length), pageToken },
        });
        ids.push(...(r.threads ?? []).map((t) => t.id));
        pageToken = r.nextPageToken;
      } while (pageToken && ids.length < perAccount);
      if (pageToken) truncated = true;
      conversations += ids.length;
      const me = a.email.toLowerCase();
      const threads = await mapLimit(ids, 8, (id) => gm.request<GmailThread>("GET", `/threads/${id}`, { query: { format: "metadata", metadataHeaders: ["From"] } }).catch(() => null));
      for (const t of threads) {
        for (const m of t?.messages ?? []) {
          const labels = m.labelIds ?? [];
          if (labels.some((l) => l === "DRAFT" || l === "SPAM" || l === "TRASH" || l === "CHAT")) continue;
          const from = parseAddress(header(m.payload, "From") || "unknown");
          messages.push({ threadId: t!.id, accountId: a.id, at: Number(m.internalDate ?? 0), fromEmail: from.email, fromName: from.name, fromMe: labels.includes("SENT") || from.email === me });
        }
      }
    } catch (err) {
      errors.push({ accountId: a.id, code: err instanceof HttpError ? err.code : "error", message: err instanceof HttpError ? err.message : "Could not load this account." });
    }
  }));
  if (accs.length > 0 && errors.length === accs.length && errors[0]) {
    const e = errors[0];
    throw new HttpError(e.code === "account_reauth" ? 401 : e.code === "insufficient_scopes" ? 403 : 502, e.code, e.message);
  }
  return { messages, errors, truncated, conversations };
}

export async function inboxStats(userId: string, p: { days: StatsRange; account?: string; tz?: string }, now = Date.now()): Promise<InboxStats> {
  const timeZone = safeTimeZone(p.tz);
  const { messages, errors, truncated, conversations } = await collect(userId, p.account, p.days);
  return {
    generatedAt: new Date(now).toISOString(),
    days: p.days,
    timeZone,
    ...computeStats(messages, { days: p.days, now, timeZone }),
    sample: { conversations, limit: STATS_THREAD_LIMIT, truncated },
    errors,
  };
}
