import { describe, expect, it } from "vitest";
import { isOpenQuestion } from "../../server/ai/features.js";
import type { ThreadSummary } from "../../shared/mail.js";

const now = Date.parse("2026-11-10T12:00:00Z");
const t = (x: Partial<ThreadSummary>): ThreadSummary => ({
  id: "t", accountId: "a", subject: "Hello", snippet: "", participants: [], from: { name: "Sofia", email: "sofia@northwind.example" }, to: [],
  lastDate: "2026-11-09T12:00:00Z", messageCount: 1, unread: false, starred: false, important: false, hasAttachments: false, labelIds: ["INBOX"], lastFromMe: false, ...x,
});

describe("follow-up radar: isOpenQuestion", () => {
  it("flags questions from people", () => {
    expect(isOpenQuestion(t({ snippet: "Does Thursday work?" }), now)).toBe(true);
    expect(isOpenQuestion(t({ snippet: "Could you send the deck" }), now)).toBe(true);
    expect(isOpenQuestion(t({ snippet: "Please confirm the slot" }), now)).toBe(true);
  });
  it("ignores answered, bulk, no-reply, old or question-less threads", () => {
    expect(isOpenQuestion(t({ snippet: "Works?", lastFromMe: true }), now)).toBe(false);
    expect(isOpenQuestion(t({ snippet: "Want 50% off?", labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }), now)).toBe(false);
    expect(isOpenQuestion(t({ snippet: "Rate us?", from: { name: "Shop", email: "no-reply@shop.example" } }), now)).toBe(false);
    expect(isOpenQuestion(t({ snippet: "Still on?", lastDate: "2026-10-01T00:00:00Z" }), now)).toBe(false);
    expect(isOpenQuestion(t({ snippet: "Thanks, all done." }), now)).toBe(false);
  });
});
