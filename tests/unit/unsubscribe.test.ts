import { describe, expect, it } from "vitest";
import { parseListUnsubscribe } from "../../server/lib/listUnsubscribe.js";
import { isPublicAddress, oneClickTarget } from "../../server/lib/oneClick.js";
import { groupSenders } from "../../server/services/unsubscribe.js";
import { unsubActionSchema, unsubArchiveSchema } from "../../shared/unsubscribe.js";

describe("parseListUnsubscribe", () => {
  it("reads one-click https and mailto entries", () => {
    const p = parseListUnsubscribe("<https://news.example.com/u?id=1>, <mailto:leave@news.example.com?subject=stop&body=please%20remove>", "List-Unsubscribe=One-Click");
    expect(p).toEqual({
      oneClickUrl: "https://news.example.com/u?id=1",
      httpsUrl: "https://news.example.com/u?id=1",
      mailto: { address: "leave@news.example.com", subject: "stop", body: "please remove" },
    });
  });
  it("needs List-Unsubscribe-Post for one-click and https for any link", () => {
    expect(parseListUnsubscribe("<https://a.example.com/u>")?.oneClickUrl).toBeNull();
    expect(parseListUnsubscribe("<https://a.example.com/u>")?.httpsUrl).toBe("https://a.example.com/u");
    expect(parseListUnsubscribe("<http://a.example.com/u>", "List-Unsubscribe=One-Click")).toBeNull();
    expect(parseListUnsubscribe("<javascript:alert(1)>", "List-Unsubscribe=One-Click")).toBeNull();
    expect(parseListUnsubscribe("<https://user:pw@a.example.com/u>", "List-Unsubscribe=One-Click")).toBeNull();
    expect(parseListUnsubscribe("")).toBeNull();
  });
  it("rejects mailto values that could add recipients or headers", () => {
    expect(parseListUnsubscribe("<mailto:a@x.example.com,b@y.example.com>")).toBeNull();
    expect(parseListUnsubscribe("<mailto:a@x.example.com%0d%0aBcc:%20evil@y.example.com>")).toBeNull();
    expect(parseListUnsubscribe("<mailto:not-an-address>")).toBeNull();
    const p = parseListUnsubscribe("<mailto:a@x.example.com?subject=hi%0d%0aBcc:%20evil@y.example.com>");
    expect(p?.mailto?.subject).toBe("hi Bcc: evil@y.example.com");
    expect(parseListUnsubscribe("<mailto:A@X.example.com>")?.mailto).toEqual({ address: "a@x.example.com", subject: "Unsubscribe", body: "" });
  });
});

describe("one-click target safety", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
      "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::7f00:1", "2002:7f00:1::", "2001:0:4136:e378::1", "192.0.2.1", "203.0.113.9"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
  it("only allows https on 443 to public hosts", () => {
    expect(oneClickTarget("https://news.example.com/u")?.hostname).toBe("news.example.com");
    expect(oneClickTarget("https://news.example.com:443/u")).not.toBeNull();
    for (const bad of ["http://news.example.com/u", "https://news.example.com:8443/u", "https://127.0.0.1/u", "https://[::1]/u", "https://169.254.169.254/latest",
      "https://localhost/u", "https://intranet/u", "https://[::ffff:7f00:1]/u", "https://0x7f.1/u", "https://2130706433/u", "https://127.1/u", "https://printer.local/u", "https://u:p@news.example.com/", "ftp://x.example.com/", "nonsense"]) {
      expect(oneClickTarget(bad), bad).toBeNull();
    }
  });
});

describe("groupSenders", () => {
  const msg = (id: string, from: string, at: number, unread: boolean, extra: Partial<{ lu: string; post: string; inbox: boolean; acc: string }> = {}) => ({
    accountId: extra.acc ?? "a1", id, from, name: from.split("@")[0]!, at, unread, inInbox: extra.inbox ?? true,
    listUnsubscribe: extra.lu ?? `<https://${from.split("@")[1]}/u>`, listUnsubscribePost: extra.post ?? "List-Unsubscribe=One-Click",
  });
  it("ranks least-opened senders first and uses the latest message for actions", () => {
    const s = groupSenders([
      msg("1", "news@a.example.com", 1, false), msg("2", "news@a.example.com", 2, false),
      msg("3", "promo@b.example.com", 1, true), msg("4", "promo@b.example.com", 3, true), msg("5", "promo@b.example.com", 2, false, { inbox: false }),
      msg("6", "deals@c.example.com", 5, true),
    ]);
    expect(s.map((x) => [x.email, x.openRate])).toEqual([["deals@c.example.com", 0], ["promo@b.example.com", 1 / 3], ["news@a.example.com", 1]]);
    const promo = s[1]!;
    expect(promo).toMatchObject({ total: 3, read: 1, unread: 2, inInbox: 2, messageId: "4", methods: { oneClick: true, mailto: null, link: null } });
  });
  it("keeps accounts apart and offers a link when one-click isn't supported", () => {
    const s = groupSenders([msg("1", "n@a.example.com", 1, true, { post: "" }), msg("2", "n@a.example.com", 1, true, { acc: "a2", lu: "<mailto:x@a.example.com>" })]);
    expect(s).toHaveLength(2);
    expect(s.find((x) => x.accountId === "a1")!.methods).toEqual({ oneClick: false, mailto: null, link: "https://a.example.com/u" });
    expect(s.find((x) => x.accountId === "a2")!.methods.mailto).toEqual({ address: "x@a.example.com", subject: "Unsubscribe" });
  });
});

describe("action schemas", () => {
  const acc = "00000000-0000-4000-8000-000000000000";
  it("require an explicit confirm", () => {
    expect(unsubActionSchema.safeParse({ accountId: acc, messageId: "m1", method: "one-click" }).success).toBe(false);
    expect(unsubActionSchema.safeParse({ accountId: acc, messageId: "m1", method: "one-click", confirm: true }).success).toBe(true);
    expect(unsubArchiveSchema.safeParse({ senders: [{ accountId: acc, email: "a@b.example.com" }] }).success).toBe(false);
  });
  it("reject sender values that could change the Gmail query", () => {
    for (const email of ["a@b.example.com OR in:anywhere", "a@b.example.com)", "\"a\"@b.example.com", "{a@b.example.com}"]) {
      expect(unsubArchiveSchema.safeParse({ senders: [{ accountId: acc, email }], confirm: true }).success, email).toBe(false);
    }
  });
});
