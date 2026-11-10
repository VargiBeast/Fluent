import { describe, expect, it } from "vitest";
import { keywordQuery, validateGmailQuery } from "../../server/ai/features.js";
import { allowedIn, localDay } from "../../server/ai/brief.js";

describe("validateGmailQuery", () => {
  it.each([
    "invoice",
    "from:ola invoice after:2026/10/01 before:2026/11/01",
    '(from:ola OR from:kari) subject:"faktura oktober" -in:sent',
    "has:attachment filename:pdf newer_than:30d is:unread",
    "category:promotions older_than:1y",
    'from:"Ola Nordmann" 14:00',
  ])("accepts %s", (q) => expect(validateGmailQuery(q)).toBe(q));

  it.each([
    "", "a\nb", 'subject:"open', "(from:ola", "from:ola)", "https://evil.example", "after:yesterday", "in:everything",
    "is:hacked", "x".repeat(301), "rfc822msgid:abc", "javascript:alert(1)",
  ])("rejects %j", (q) => expect(validateGmailQuery(q)).toBeNull());

  it("collapses whitespace", () => expect(validateGmailQuery("  from:ola   invoice ")).toBe("from:ola invoice"));
});

describe("keywordQuery", () => {
  it("keeps meaningful words only", () => {
    expect(keywordQuery("What did Ola say about the invoice in October?")).toBe("ola invoice october");
    expect(keywordQuery("what is it?")).toBeNull();
  });
});

describe("brief helpers", () => {
  const t = (o: Partial<{ starred: boolean; important: boolean; lastFromMe: boolean; labelIds: string[] }>) => ({ starred: false, important: false, lastFromMe: false, labelIds: ["INBOX"], ...o }) as never;
  it("never archives starred, important or non-inbox mail", () => {
    expect(allowedIn("safe_to_archive", t({}))).toBe(true);
    expect(allowedIn("safe_to_archive", t({ starred: true }))).toBe(false);
    expect(allowedIn("safe_to_archive", t({ important: true }))).toBe(false);
    expect(allowedIn("safe_to_archive", t({ labelIds: [] }))).toBe(false);
    expect(allowedIn("awaiting_reply", t({ lastFromMe: true }))).toBe(false);
  });
  it("computes the local day per time zone", () => {
    const at = new Date("2026-11-10T23:30:00Z");
    expect(localDay("Europe/Oslo", at)).toBe("2026-11-11");
    expect(localDay("America/New_York", at)).toBe("2026-11-10");
    expect(localDay("Not/AZone", at)).toBe("2026-11-10");
  });
});
