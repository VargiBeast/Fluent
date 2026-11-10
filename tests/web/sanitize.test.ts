import { describe, expect, it } from "vitest";
import { buildSrcDoc, sanitizeEmailHtml, splitQuoted, textToHtml } from "@/lib/sanitize";

const clean = (html: string, allowRemoteImages = false) => sanitizeEmailHtml(html, { allowRemoteImages });

describe("email HTML sanitizer", () => {
  it("removes scripts, event handlers, forms and embedded frames", () => {
    const { html } = clean(`<p onclick="alert(1)">hi</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil"></iframe><form action="https://evil"><input name=p></form><svg><script>alert(1)</script></svg><object data="x"></object>`);
    expect(html).toContain("<p>hi</p>");
    expect(html).not.toMatch(/script|onerror|onclick|iframe|<form|<input|<svg|<object/i);
  });

  it("neutralises javascript:, data: and root-relative links and opens links safely", () => {
    const { html } = clean(`<a href="javascript:alert(1)">a</a><a href="data:text/html,x">b</a><a href="/api/auth/logout">c</a><a href="https://ok.example/x">d</a><a href="mailto:a@b.c">e</a>`);
    expect(html).not.toMatch(/javascript:|data:text|\/api\/auth/);
    expect(html).toContain('href="https://ok.example/x"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).toMatch(/rel="noopener noreferrer nofollow"/);
    expect(html).toMatch(/target="_blank"/);
  });

  it("blocks remote images, CSS background urls and @import by default (tracking pixels)", () => {
    const r = clean(`<img src="https://t.example/open.gif" width=1 height=1><div style="background:url(https://t.example/bg.png)">x</div><style>@import url(https://t.example/a.css); .a{background:url('//t.example/b.png')}</style>`);
    expect(r.blockedImages).toBeGreaterThanOrEqual(3); // each remote resource (img, CSS url, @import) counts
    expect(r.html).not.toContain("t.example");
  });

  it("allows remote images only when the user opts in", () => {
    const r = clean(`<img src="https://img.example/photo.jpg" alt="p">`, true);
    expect(r.blockedImages).toBe(0);
    expect(r.html).toContain("https://img.example/photo.jpg");
    expect(r.html).not.toMatch(/srcset|ping=/);
  });

  it("resolves inline cid: images from attachments and drops unknown ones", () => {
    const r = sanitizeEmailHtml(`<img src="cid:logo@x"><img src="cid:missing">`, { allowRemoteImages: false, cidMap: { "logo@x": "data:image/png;base64,iVBORw0KGgo=" } });
    expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(r.html.match(/src=/g)).toHaveLength(1);
  });

  it("prevents UI overlay via fixed positioning", () => {
    const { html } = clean(`<div style="position:fixed;top:0;left:0;width:100%">phish</div>`);
    expect(html).not.toMatch(/position:\s*fixed/);
  });

  it("detects designed (rich) emails so they render on a light canvas", () => {
    expect(clean(`<table bgcolor="#fff"><tr><td>x</td></tr></table>`).rich).toBe(true);
    expect(clean(`<p>plain</p>`).rich).toBe(false);
  });
});

describe("iframe document", () => {
  it("has a CSP that forbids scripts and only permits remote images when allowed", () => {
    const blocked = buildSrcDoc("<p>x</p>", { dark: true, rich: false, allowRemoteImages: false, showQuoted: false });
    expect(blocked).toContain("default-src 'none'");
    expect(blocked).toContain("img-src data:;");
    expect(blocked).not.toContain("script-src");
    expect(blocked).toContain('<meta name="referrer" content="no-referrer">');
    const allowed = buildSrcDoc("<p>x</p>", { dark: true, rich: false, allowRemoteImages: true, showQuoted: false });
    expect(allowed).toContain("img-src data: https:;");
  });
});

describe("plain text helpers", () => {
  it("escapes text and linkifies safely", () => {
    const h = textToHtml(`<b>not bold</b> see https://example.com/a?b=1&c=2`);
    expect(h).not.toContain("<b>");
    expect(h).toContain("&lt;b&gt;");
    expect(h).toMatch(/<a [^>]*href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  });

  it("splits quoted replies", () => {
    const r = splitQuoted("Thanks, works for me.\n\nOn Tue, Nov 10, 2026 at 9:00 Sofia wrote:\n> Could you confirm?");
    expect(r.main).toBe("Thanks, works for me.");
    expect(r.quoted).toMatch(/^On Tue/);
  });
});
