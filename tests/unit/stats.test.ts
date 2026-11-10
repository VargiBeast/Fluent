import { describe, expect, it } from "vitest";
import { computeStats, safeTimeZone, type StatMessage } from "../../server/services/stats.js";

const NOW = Date.parse("2026-11-10T18:00:00Z"); // a Tuesday
const H = 3600_000;
const m = (threadId: string, hoursAgo: number, from: string, fromMe = false, accountId = "a1"): StatMessage => ({
  threadId, accountId, at: NOW - hoursAgo * H, fromEmail: from, fromName: from.split("@")[0]!, fromMe,
});

describe("computeStats", () => {
  const msgs = [
    m("t1", 50, "sofia@x.test"), m("t1", 48, "me@x.test", true), // reply after 2h
    m("t2", 30, "sofia@x.test"), m("t2", 29.5, "sofia@x.test"), m("t2", 5, "me@x.test", true), // waits from the first unanswered: 25h
    m("t3", 3, "news@shop.test"), // never answered
    m("t4", 10, "me@x.test", true), // new email, not a reply
    m("t5", 24 * 40, "old@x.test"), m("t5", 24 * 40 - 1, "me@x.test", true), // outside a 30-day window
    m("t6", 2, "bob@x.test", false, "a2"), m("t6", 1.5, "me2@x.test", true, "a2"), // other account: 30 min
  ];

  it("counts volume per day, totals and top senders", () => {
    const s = computeStats(msgs, { days: 7, now: NOW, timeZone: "UTC" });
    expect(s.granularity).toBe("day");
    expect(s.volume).toHaveLength(7);
    expect(s.volume.at(-1)).toEqual({ start: "2026-11-10", received: 2, sent: 3 });
    expect(s.volume[0]!.start).toBe("2026-11-04");
    expect(s.totals).toEqual({ received: 5, sent: 4, conversations: 5 });
    expect(s.topSenders[0]).toEqual({ email: "sofia@x.test", name: "sofia", count: 3 });
    expect(s.topSenders.map((t) => t.email)).not.toContain("me@x.test");
    expect(s.byHour.reduce((a, b) => a + b, 0)).toBe(5);
    expect(s.byHour[15]).toBe(1); // t3 at 15:00 UTC
  });

  it("measures response time from the first unanswered message to your reply", () => {
    const s = computeStats(msgs, { days: 7, now: NOW, timeZone: "UTC" });
    expect(s.response.replies).toBe(3);
    expect(s.response.medianMinutes).toBe(120);
    expect(s.response.averageMinutes).toBe(Math.round((120 + 25 * 60 + 30) / 3));
    expect(Object.fromEntries(s.response.buckets.map((b) => [b.id, b.count]))).toEqual({ lt1h: 1, "1to4h": 1, "4to24h": 0, "1to3d": 1, gt3d: 0 });
  });

  it("buckets by week for 90 days and keeps empty buckets", () => {
    const s = computeStats(msgs, { days: 90, now: NOW, timeZone: "UTC" });
    expect(s.granularity).toBe("week");
    expect(s.volume.at(-1)!.start).toBe("2026-11-09"); // Monday
    expect(s.volume.every((b) => new Date(`${b.start}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(s.volume.length).toBeGreaterThanOrEqual(13);
    expect(s.totals.received).toBe(6);
    expect(s.response.replies).toBe(4);
  });

  it("uses the user's time zone for day boundaries", () => {
    const late = [m("t", 17.5, "x@y.test")]; // 2026-11-10T00:30Z = Nov 9 evening in New York
    expect(computeStats(late, { days: 7, now: NOW, timeZone: "UTC" }).volume.at(-1)!.received).toBe(1);
    const ny = computeStats(late, { days: 7, now: NOW, timeZone: "America/New_York" });
    expect(ny.volume.find((b) => b.start === "2026-11-09")!.received).toBe(1);
    expect(ny.byHour[19]).toBe(1);
  });

  it("handles an empty mailbox", () => {
    const s = computeStats([], { days: 30, now: NOW, timeZone: "UTC" });
    expect(s.volume).toHaveLength(30);
    expect(s.response).toMatchObject({ averageMinutes: null, medianMinutes: null, replies: 0 });
    expect(s.topSenders).toEqual([]);
  });

  it("falls back to UTC for unknown time zones", () => {
    expect(safeTimeZone("Europe/Oslo")).toBe("Europe/Oslo");
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });
});
