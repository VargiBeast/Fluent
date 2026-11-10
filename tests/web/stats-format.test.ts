import { describe, expect, it } from "vitest";
import { bucketLabel, formatDuration, niceMax } from "@/lib/stats";

describe("stats formatting", () => {
  it("formats durations", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0.2)).toBe("< 1 min");
    expect(formatDuration(42)).toBe("42 min");
    expect(formatDuration(90)).toBe("1.5 h");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(60 * 15)).toBe("15 h");
    expect(formatDuration(60 * 36)).toBe("1.5 days");
    expect(formatDuration(60 * 24 * 12)).toBe("12 days");
  });

  it("rounds chart maxima to 1/2/5 steps", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(12)).toBe(20);
    expect(niceMax(200)).toBe(200);
    expect(niceMax(201)).toBe(500);
  });

  it("labels buckets without shifting the date across zones", () => {
    expect(bucketLabel("2026-11-09", "day")).toMatch(/9/);
    expect(bucketLabel("2026-11-09", "week", true)).toMatch(/^Week of .*9/);
  });
});
