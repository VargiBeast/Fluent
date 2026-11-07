import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState, ErrorState, FluentChrome } from "./components/fluent/shell";
import { ConfirmDialog } from "./components/fluent/confirm-dialog";
import { buildSafeEmailDocument } from "./lib/email-frame";

describe("fluent interface", () => {
  it("renders desktop and mobile navigation with the main destinations", () => {
    const html = renderToStaticMarkup(
      createElement(FluentChrome, { demo: true, email: "demo@fluent.invalid", pathname: "/inbox" }, createElement("p", null, "Inbox body")),
    );
    for (const label of ["Overview", "Inbox", "Copilot", "Settings", "Sent", "Compose"]) {
      assert.match(html, new RegExp(label));
    }
    assert.match(html, /desktop-nav/);
    assert.match(html, /mobile-nav/);
    assert.match(html, /Demo mailbox/);
    assert.match(html, /Skip to content/);
  });

  it("renders empty and error states", () => {
    const empty = renderToStaticMarkup(createElement(EmptyState, { title: "Nothing here", body: "Connect Gmail." }));
    const error = renderToStaticMarkup(createElement(ErrorState, { message: "Mailbox unavailable" }));
    assert.match(empty, /Nothing here/);
    assert.match(error, /role="alert"/);
  });

  it("names the destructive confirmation", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: true,
        title: "Move this conversation to Trash?",
        body: "Northwind invoice. This does not permanently delete it.",
        confirmLabel: "Move to Trash",
        onConfirm() {},
        onCancel() {},
      }),
    );
    assert.match(html, /Move this conversation to Trash/);
    assert.match(html, /does not permanently delete/);
  });

  it("frames email html without scripts and blocks remote images by default", () => {
    const doc = buildSafeEmailDocument(`<p>Hello</p><script>alert(1)</script>`, { allowRemoteImages: false });
    assert.match(doc, /default-src 'none'/);
    assert.match(doc, /img-src 'none'/);
    assert.match(doc, /<p>Hello<\/p>/);
  });

  it("collapses the desktop sidebar in the mobile stylesheet", () => {
    const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    assert.match(css, /@media \(max-width: 800px\)/);
    assert.match(css, /\.desktop-nav \{\s*display: none;/);
    assert.match(css, /prefers-reduced-motion: reduce/);
    assert.match(css, /#101116/);
    assert.match(css, /#806bff/i);
  });
});
