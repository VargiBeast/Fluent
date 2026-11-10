import { describe, expect, it } from "vitest";
import { toggled, type ReadLaterItem } from "@/lib/readLater";

describe("read later optimistic toggle", () => {
  const base: ReadLaterItem[] = [{ accountId: "a", threadId: "t1", addedAt: "2026-01-01T00:00:00.000Z" }];
  it("adds to the front once", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    expect(toggled(base, "a", "t2", true, now).map((i) => i.threadId)).toEqual(["t2", "t1"]);
    expect(toggled(base, "a", "t1", true, now)).toHaveLength(1);
  });
  it("removes only the matching account + thread", () => {
    expect(toggled(base, "b", "t1", false)).toHaveLength(1);
    expect(toggled(base, "a", "t1", false)).toEqual([]);
  });
});
