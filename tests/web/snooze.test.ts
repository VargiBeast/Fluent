import { describe, expect, it } from "vitest";
import { snoozePresets } from "../../web/src/lib/snooze";

describe("snooze presets", () => {
  it("are all in the future and ordered", () => {
    const now = new Date(2026, 10, 10, 10, 0); // Tue 10:00 local
    const p = snoozePresets(now);
    expect(p.map((x) => x.id)).toEqual(["later", "tomorrow", "weekend", "nextweek"]);
    for (const x of p) expect(x.until.getTime()).toBeGreaterThan(now.getTime());
    expect(p[1]!.until.getHours()).toBe(8);
    expect(p[2]!.until.getDay()).toBe(6);
    expect(p[3]!.until.getDay()).toBe(1);
  });
  it("drops 'later today' in the evening", () => {
    expect(snoozePresets(new Date(2026, 10, 10, 22, 30)).map((x) => x.id)).not.toContain("later");
  });
});
