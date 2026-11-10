import { describe, expect, it } from "vitest";
import { focusEndsAt, focusUntilSchema, isFocusActive } from "../../shared/focus";
import { parseSettings, settingsPatchSchema } from "../../shared/settings";

describe("focus mode periods", () => {
  const now = new Date("2026-11-10T19:50:00Z"); // 20:50 in Oslo
  it("adds 30 minutes or an hour", () => {
    expect(focusEndsAt("30m", now, "Europe/Oslo").toISOString()).toBe("2026-11-10T20:20:00.000Z");
    expect(focusEndsAt("1h", now, "Europe/Oslo").toISOString()).toBe("2026-11-10T20:50:00.000Z");
  });
  it("ends tomorrow at 08:00 in the user's time zone", () => {
    expect(focusEndsAt("tomorrow", now, "Europe/Oslo").toISOString()).toBe("2026-11-11T07:00:00.000Z");
    expect(focusEndsAt("tomorrow", now, "America/New_York").toISOString()).toBe("2026-11-11T13:00:00.000Z");
    // 23:30 UTC is already the 11th in Tokyo, so "tomorrow" is the 12th there.
    expect(focusEndsAt("tomorrow", new Date("2026-11-10T23:30:00Z"), "Asia/Tokyo").toISOString()).toBe("2026-11-11T23:00:00.000Z");
  });
  it("handles a DST change overnight", () => {
    // Europe/Oslo moves to summer time on 29 March 2026: 08:00 that morning is 06:00 UTC.
    expect(focusEndsAt("tomorrow", new Date("2026-03-28T21:00:00Z"), "Europe/Oslo").toISOString()).toBe("2026-03-29T06:00:00.000Z");
  });
  it("is active only before its end", () => {
    expect(isFocusActive(null)).toBe(false);
    expect(isFocusActive("2026-11-10T20:20:00Z", now.getTime())).toBe(true);
    expect(isFocusActive("2026-11-10T19:00:00Z", now.getTime())).toBe(false);
  });
  it("accepts only off or a future end within 36 hours", () => {
    expect(focusUntilSchema.safeParse(null).success).toBe(true);
    expect(focusUntilSchema.safeParse(new Date(Date.now() + 3600_000).toISOString()).success).toBe(true);
    expect(focusUntilSchema.safeParse(new Date(Date.now() + 40 * 3600_000).toISOString()).success).toBe(false);
    expect(focusUntilSchema.safeParse(new Date(Date.now() - 3600_000).toISOString()).success).toBe(false);
    expect(focusUntilSchema.safeParse("tomorrow").success).toBe(false);
  });
});

describe("accent and focus settings", () => {
  it("defaults to purple with focus off, and falls back on bad stored values", () => {
    expect(parseSettings({}).appearance.accent).toBe("purple");
    expect(parseSettings({}).focus.until).toBeNull();
    const s = parseSettings({ appearance: { accent: "neon", theme: "light" }, focus: { until: "garbage" } });
    expect(s.appearance).toMatchObject({ accent: "purple", theme: "light" });
    expect(s.focus.until).toBeNull();
  });
  it("validates patches strictly", () => {
    expect(settingsPatchSchema.safeParse({ appearance: { accent: "rose" } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ appearance: { accent: "#ff0000" } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ focus: {} }).success).toBe(false);
  });
});
