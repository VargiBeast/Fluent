import { describe, expect, it } from "vitest";
import type { NewsletterSender } from "@shared/unsubscribe";
import { openRateLabel, openRateTone, orderSenders, readUnsubscribed, senderKey, writeUnsubscribed } from "@/lib/newsletters";

const s = (email: string, accountId = "a1"): NewsletterSender => ({
  accountId, email, name: email, total: 4, read: 1, unread: 3, openRate: 0.25, inInbox: 2, lastAt: "2026-11-01T00:00:00.000Z", messageId: "m",
  methods: { oneClick: true, mailto: null, link: null },
});

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("newsletter helpers", () => {
  it("moves unsubscribed senders to the end, keeping the rest in order", () => {
    const list = [s("a@x.example"), s("b@x.example"), s("c@x.example")];
    expect(orderSenders(list, { [senderKey(list[0]!)]: "2026-11-02T00:00:00Z" }).map((x) => x.email)).toEqual(["b@x.example", "c@x.example", "a@x.example"]);
    expect(orderSenders(list, { "a2:a@x.example": "2026-11-02T00:00:00Z" }).map((x) => x.email)).toEqual(["a@x.example", "b@x.example", "c@x.example"]);
  });

  it("remembers unsubscribes per user in local storage and forgets old or bad entries", () => {
    const st = memoryStorage();
    const now = Date.parse("2026-11-10T00:00:00Z");
    writeUnsubscribed("u1", { "a1:a@x.example": "2026-11-09T00:00:00.000Z", "a1:old@x.example": "2026-01-01T00:00:00.000Z" }, st);
    expect(readUnsubscribed("u1", st, now)).toEqual({ "a1:a@x.example": "2026-11-09T00:00:00.000Z" });
    expect(readUnsubscribed("u2", st, now)).toEqual({});
    st.setItem("fluent:unsubscribed:u3", "not json");
    expect(readUnsubscribed("u3", st, now)).toEqual({});
    st.setItem("fluent:unsubscribed:u4", JSON.stringify({ k: 5 }));
    expect(readUnsubscribed("u4", st, now)).toEqual({});
  });

  it("describes how often a newsletter is opened", () => {
    expect(openRateLabel({ read: 1, total: 4 })).toBe("Opened 1 of 4 (25%)");
    expect(openRateTone(0)).toBe("low");
    expect(openRateTone(0.5)).toBe("mid");
    expect(openRateTone(0.9)).toBe("high");
  });
});
