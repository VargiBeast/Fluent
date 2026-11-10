import DOMPurify from "dompurify";

export interface SanitizeOptions {
  allowRemoteImages: boolean;
  /** Map of Content-ID -> data: URL for inline images. */
  cidMap?: Record<string, string>;
}

export interface SanitizeResult {
  html: string;
  blockedImages: number;
  rich: boolean;
}

const FORBID_TAGS = ["script", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "textarea", "select", "option", "base", "meta", "link", "svg", "math", "video", "audio", "source", "track", "portal"];
const FORBID_ATTR = ["srcset", "ping", "formaction", "action", "background", "poster", "xlink:href", "srcdoc"];

/**
 * Sanitize untrusted email HTML. Output is additionally rendered inside a sandboxed iframe
 * (no scripts) with a restrictive CSP, so this is defence in depth, not the only layer.
 */
export function sanitizeEmailHtml(dirty: string, opts: SanitizeOptions): SanitizeResult {
  let blocked = 0;
  const purify = DOMPurify();
  purify.addHook("uponSanitizeElement", (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (/^cid:/i.test(src)) {
        const cid = src.slice(4).replace(/[<>]/g, "");
        const data = opts.cidMap?.[cid];
        if (data) node.setAttribute("src", data);
        else node.removeAttribute("src");
      } else if (/^https?:/i.test(src) || src.startsWith("//")) {
        if (!opts.allowRemoteImages) {
          blocked++;
          node.removeAttribute("src");
          node.setAttribute("data-blocked", "1");
          node.setAttribute("alt", node.getAttribute("alt") || "");
        }
      } else if (!/^data:image\/(png|gif|jpe?g|webp);/i.test(src)) {
        node.removeAttribute("src");
      }
    }
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof Element)) return;
    if (node.tagName === "A") {
      const href = node.getAttribute("href") ?? "";
      if (href && !/^(https?:|mailto:|tel:|#)/i.test(href)) node.removeAttribute("href");
      // Root-relative or anchor links would resolve against FLUENT; neutralise them.
      if (href.startsWith("/") || href.startsWith("#")) node.removeAttribute("href");
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    const style = node.getAttribute("style");
    if (style) {
      // Strip CSS that could fetch remote resources or overlay the UI.
      let s = style.replace(/expression\s*\(/gi, "").replace(/position\s*:\s*(fixed|sticky)/gi, "position:static");
      if (!opts.allowRemoteImages) {
        s = s.replace(/url\s*\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, () => {
          blocked++;
          return "none";
        });
      }
      node.setAttribute("style", s);
    }
  });
  const html = purify.sanitize(dirty, {
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOW_DATA_ATTR: false,
    WHOLE_DOCUMENT: false,
    FORCE_BODY: true,
    ADD_ATTR: ["target"],
  });
  let out = html;
  if (!opts.allowRemoteImages) {
    out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (_m, attrs: string, css: string) => {
      const cleaned = css.replace(/url\s*\(\s*['"]?\s*(https?:)?\/\/[^)]*\)/gi, () => {
        blocked++;
        return "none";
      }).replace(/@import[^;]+;/gi, "");
      return `<style${attrs}>${cleaned}</style>`;
    });
  } else {
    out = out.replace(/@import[^;]+;/gi, "");
  }
  const rich = /bgcolor|background(-color)?\s*:|<table/i.test(out);
  return { html: out, blockedImages: blocked, rich };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Plain-text body → safe HTML with linkified URLs. */
export function textToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>')
    .replace(/\n/g, "<br>");
}

/** Split a plain-text body into the new part and the quoted history (e.g. "On … wrote:"). */
export function splitQuoted(text: string): { main: string; quoted: string | null } {
  const m = /\n(On .{5,200}wrote:\s*\n|-{2,} ?Original Message ?-{2,}|>.*\n>)/.exec(text);
  if (!m || m.index < 20) return { main: text, quoted: null };
  return { main: text.slice(0, m.index).trimEnd(), quoted: text.slice(m.index).trim() };
}

export function buildSrcDoc(bodyHtml: string, opts: { dark: boolean; rich: boolean; allowRemoteImages: boolean; showQuoted: boolean }): string {
  const img = opts.allowRemoteImages ? "data: https:" : "data:";
  const csp = `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`;
  const fg = opts.rich || !opts.dark ? "#1b1a22" : "#d9d8e0";
  const link = opts.rich || !opts.dark ? "#6d28d9" : "#b9a3fb";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
html{color-scheme:${opts.dark && !opts.rich ? "dark" : "light"};}
html,body{margin:0;padding:0;background:${opts.rich ? "#ffffff" : "transparent"};}
body{color:${fg};font:14px/1.6 "Inter Variable",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;word-wrap:break-word;overflow-wrap:anywhere;padding:${opts.rich ? "16px" : "0"};}
a{color:${link};}
img{max-width:100%;height:auto;}
img[data-blocked]{display:inline-block;min-width:16px;min-height:16px;background:rgba(127,127,127,.15);}
table{max-width:100%;}
pre{white-space:pre-wrap;}
blockquote{margin:0 0 0 .4em;padding-left:.8em;border-left:2px solid rgba(127,127,127,.35);}
${opts.showQuoted ? "" : ".gmail_quote,blockquote[type=cite],.yahoo_quoted,#appendonsend~*{display:none!important;}"}
</style></head><body>${bodyHtml}</body></html>`;
}
