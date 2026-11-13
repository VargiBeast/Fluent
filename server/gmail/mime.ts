import { randomBytes } from "node:crypto";
import { badRequest } from "../lib/errors.js";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface MimeMessage {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  inReplyTo?: string;
  references?: string;
  attachments: MimeAttachment[];
}

/** Reject CR/LF (header injection) and NUL in any header-bound value. */
export function assertHeaderSafe(v: string, what: string): string {
  if (/[\r\n\0]/.test(v)) throw badRequest(`Invalid characters in ${what}`);
  return v;
}

export function encodeWord(v: string): string {
  // ASCII printable stays as-is; otherwise RFC 2047 B-encoding.
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

/** Format "Name <email>" with the display name safely quoted/encoded. */
export function formatAddress(name: string | undefined, email: string): string {
  assertHeaderSafe(email, "address");
  if (!name || name === email) return email;
  assertHeaderSafe(name, "name");
  // Prefer quoted-string for pure ASCII; encodeWord for anything else.
  const safe = /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, "\\$&")}"` : encodeWord(name);
  return `${safe} <${email}>`;
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

function filenameParam(name: string): string {
  const clean = name.replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "attachment";
  // RFC 2231 filename* for non-ASCII; plain filename as fallback.
  if (/^[\x20-\x7e]*$/.test(clean)) return `filename="${clean}"`;
  return `filename="${encodeWord(clean)}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

/** Build an RFC 5322 message (multipart/alternative inside multipart/mixed when attaching). */
export function buildMime(m: MimeMessage): string {
  const headers = [
    `From: ${assertHeaderSafe(m.from, "from")}`,
    ...(m.to.length ? [`To: ${m.to.map((a) => assertHeaderSafe(a, "to")).join(", ")}`] : []),
    ...(m.cc.length ? [`Cc: ${m.cc.map((a) => assertHeaderSafe(a, "cc")).join(", ")}`] : []),
    ...(m.bcc.length ? [`Bcc: ${m.bcc.map((a) => assertHeaderSafe(a, "bcc")).join(", ")}`] : []),
    `Subject: ${encodeWord(assertHeaderSafe(m.subject, "subject"))}`,
    `Date: ${new Date().toUTCString()}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${assertHeaderSafe(m.inReplyTo, "In-Reply-To")}`] : []),
    ...(m.references ? [`References: ${assertHeaderSafe(m.references, "References")}`] : []),
    "MIME-Version: 1.0",
    "X-Mailer: MailIQ",
  ];
  const alt = `fluent-alt-${randomBytes(9).toString("hex")}`;
  const altBody = [
    `--${alt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(m.text, "utf8").toString("base64")),
    `--${alt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(m.html, "utf8").toString("base64")),
    `--${alt}--`,
  ].join("\r\n");
  if (!m.attachments.length) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${alt}"`, "", altBody, ""].join("\r\n");
  }
  const mixed = `fluent-mix-${randomBytes(9).toString("hex")}`;
  const parts = m.attachments.map((a) => [
    `--${mixed}`,
    `Content-Type: ${/^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType) ? a.mimeType : "application/octet-stream"}; name="${a.filename.replace(/[\r\n"\\]/g, "_")}"`,
    `Content-Disposition: attachment; ${filenameParam(a.filename)}`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(a.content.toString("base64")),
  ].join("\r\n"));
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    altBody,
    ...parts,
    `--${mixed}--`,
    "",
  ].join("\r\n");
}

export function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

/** Minimal outgoing-HTML hardening: the author is the user, but never ship active content. */
export function cleanOutgoingHtml(html: string): string {
  return html
    .replace(/<(script|iframe|object|embed|form|style)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|object|embed|form|style|link|meta|base)\b[^>]*>/gi, "")
    .replace(/\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=$2#$2");
}
