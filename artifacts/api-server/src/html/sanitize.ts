import sanitizeHtml from "sanitize-html";

const TEXT_TAGS = [
  "p",
  "br",
  "div",
  "span",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
];

export function sanitizeEmailHtml(
  input: string,
  options: { allowRemoteImages: boolean },
): string {
  const truncated = input.slice(0, 100_000);
  return sanitizeHtml(truncated, {
    allowedTags: options.allowRemoteImages ? [...TEXT_TAGS, "a", "img"] : [...TEXT_TAGS, "a"],
    allowedAttributes: {
      a: ["href", "title"],
      img: options.allowRemoteImages ? ["src", "alt"] : [],
    },
    allowedSchemes: ["https", "mailto"],
    allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tag, attribs) => ({
        tagName: "a",
        attribs: {
          href: attribs.href ?? "",
          title: attribs.title ?? "",
          rel: "noopener noreferrer nofollow",
          target: "_blank",
        },
      }),
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "img") return false;
      return !frame.attribs.src?.startsWith("https://");
    },
  });
}

export function htmlToText(html: string): string {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
}
