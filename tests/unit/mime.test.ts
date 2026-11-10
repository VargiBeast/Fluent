import { describe, expect, it } from "vitest";
import { buildMime, cleanOutgoingHtml, encodeWord, formatAddress } from "../../server/gmail/mime.js";
import { parseMime } from "../fakes/mime.js";
import { parseAddress, parseAddresses, htmlToText } from "../../server/gmail/parse.js";

describe("MIME builder", () => {
  it("builds multipart/alternative with UTF-8 subject and threading headers", () => {
    const raw = buildMime({ from: formatAddress("Ålex", "alex@x.test"), to: ["b@x.test"], cc: [], bcc: ["c@x.test"], subject: "Møte på torsdag", html: "<p>Hei</p>", text: "Hei", inReplyTo: "<a@b>", references: "<a@b>", attachments: [] });
    const p = parseMime(raw);
    const h = (n: string) => p.headers.find((x) => x.name.toLowerCase() === n)?.value;
    expect(h("subject")).toBe("Møte på torsdag");
    expect(h("from")).toBe("Ålex <alex@x.test>");
    expect(h("bcc")).toBe("c@x.test");
    expect(h("in-reply-to")).toBe("<a@b>");
    expect(p.mimeType).toBe("multipart/alternative");
    expect(p.parts?.map((x) => x.mimeType)).toEqual(["text/plain", "text/html"]);
  });
  it("attaches files inside multipart/mixed", () => {
    const raw = buildMime({ from: "a@x.test", to: ["b@x.test"], cc: [], bcc: [], subject: "f", html: "<p>x</p>", text: "x", attachments: [{ filename: "rapport ø.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF") }] });
    const att = new Map<string, Buffer>();
    const p = parseMime(raw, "", att);
    expect(p.mimeType).toBe("multipart/mixed");
    expect(p.parts?.[1]?.filename).toBe("rapport ø.pdf");
    expect([...att.values()][0]!.toString()).toBe("%PDF");
  });
  it("blocks header injection", () => {
    expect(() => buildMime({ from: "a@x.test", to: ["b@x.test"], cc: [], bcc: [], subject: "hi\r\nBcc: victim@x.test", html: "", text: "", attachments: [] })).toThrow(/Invalid characters/);
    expect(() => formatAddress("Eve\nBcc: x", "e@x.test")).toThrow();
  });
  it("encodes words only when needed and quotes display names", () => {
    expect(encodeWord("plain")).toBe("plain");
    expect(encodeWord("ø")).toMatch(/^=\?UTF-8\?B\?/);
    expect(formatAddress('A "B"', "a@x.test")).toBe('"A \\"B\\"" <a@x.test>');
  });
  it("strips active content from outgoing HTML", () => {
    const out = cleanOutgoingHtml('<p onclick="x()">hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><iframe src="x"></iframe>');
    expect(out).not.toMatch(/script|onclick|javascript:|iframe/i);
    expect(out).toContain("<p>hi</p>");
  });
});

describe("Gmail parsing helpers", () => {
  it("parses address lists with quoted commas", () => {
    expect(parseAddresses('"Doe, Jane" <jane@x.test>, bob@x.test')).toEqual([{ name: "Doe, Jane", email: "jane@x.test" }, { name: "bob@x.test", email: "bob@x.test" }]);
    expect(parseAddress("Foo <FOO@X.TEST>")).toEqual({ name: "Foo", email: "foo@x.test" });
  });
  it("converts HTML to text without scripts/styles", () => {
    const t = htmlToText("<style>.a{}</style><p>Hi&nbsp;there</p><script>evil()</script><br>Bye");
    expect(t).toMatch(/^Hi there\s+Bye$/);
    expect(t).not.toMatch(/evil|\.a/);
  });
});
