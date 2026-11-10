import { describe, expect, it } from "vitest";
import { pinMailServer } from "../../server/providers/netGuard";
import { decodeId, encodeId, imapSearch } from "../../server/providers/imap";
import { imapAccountInputSchema, IMAP_PRESETS } from "../../shared/imap";

describe("mail server pinning (SSRF)", () => {
  it.each([
    ["imap.example.com", 143], ["imap.example.com", 25], ["imap.example.com", 2525],
  ])("refuses %s:%i (only 993, 465, 587)", async (host, port) => {
    await expect(pinMailServer(host, port)).rejects.toMatchObject({ code: "mail_server_blocked" });
  });
  it.each(["127.0.0.1", "10.0.0.5", "::1", "169.254.169.254", "::ffff:7f00:1"])("refuses the IP literal %s", async (ip) => {
    await expect(pinMailServer(ip, 993)).rejects.toMatchObject({ code: "mail_server_blocked" });
  });
  it("refuses names that resolve to loopback", async () => {
    await expect(pinMailServer("localhost", 993)).rejects.toMatchObject({ code: "mail_server_blocked" });
  });
  it("ignores *.fluent.test routing unless the test port map is set", async () => {
    await expect(pinMailServer("imap.mail.fluent.test", 993)).rejects.toMatchObject({ status: 400 });
  });
});

describe("account input", () => {
  const ok = { email: "me@icloud.com", password: "abcd-efgh-ijkl-mnop", imap: IMAP_PRESETS[0]!.imap, smtp: IMAP_PRESETS[0]!.smtp };
  it("accepts the presets", () => {
    for (const p of IMAP_PRESETS) expect(imapAccountInputSchema.safeParse({ ...ok, imap: p.imap, smtp: p.smtp }).success).toBe(true);
  });
  it.each([
    [{ imap: { host: "10.0.0.1", port: 993 } }], [{ imap: { host: "imap.example.com:993", port: 993 } }], [{ imap: { host: "user@imap.example.com", port: 993 } }],
    [{ smtp: { host: "smtp.example.com", port: 25 } }], [{ password: "a\r\nb" }], [{ extra: true }],
  ])("rejects %j", (over) => {
    expect(imapAccountInputSchema.safeParse({ ...ok, ...over }).success).toBe(false);
  });
});

describe("IMAP ids and search", () => {
  it("round-trips ids and rejects anything else", () => {
    expect(decodeId(encodeId("archive", 42))).toEqual({ box: "archive", uid: 42 });
    for (const bad of ["in0", "xx1", "in1a", "in", "in12345678901", "../in1"]) expect(() => decodeId(bad)).toThrow();
  });
  it("maps a safe subset of Gmail search syntax", () => {
    expect(imapSearch("is:unread from:ola@example.org lunch")).toEqual({ seen: false, from: "ola@example.org", text: "lunch" });
    expect(imapSearch("is:important")).toEqual({ flagged: true });
    expect(imapSearch("category:social -in:sent")).toEqual({ all: true });
    expect(imapSearch(undefined)).toEqual({ all: true });
  });
});
