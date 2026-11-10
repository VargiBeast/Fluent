import type { Address, MessageDetail, ThreadDetail } from "@shared/mail";
import { escapeHtml } from "./sanitize";
import { displayName, fullDate } from "./format";

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  size: number;
  data?: string; // base64 for new uploads
  source?: { messageId: string; attachmentId: string }; // forwarded from Gmail
}

export interface SendPayload {
  accountId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string;
  text: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
  draftId?: string;
  aiGenerated: boolean;
  aiConfirmed: boolean;
}

export function fmtAddr(a: Address): string {
  return a.name && a.name !== a.email ? `${a.name} <${a.email}>` : a.email;
}

export function replySubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
  return /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`;
}

/** Compute recipients for reply / reply-all, excluding the user's own address. */
export function replyRecipients(thread: ThreadDetail, m: MessageDetail, all: boolean): { to: string[]; cc: string[] } {
  const me = thread.accountEmail.toLowerCase();
  const base = m.isFromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
  const to = base.filter((a) => a.email !== me).map(fmtAddr);
  if (!all) return { to: to.length ? to : m.to.map(fmtAddr), cc: [] };
  const seen = new Set([me, ...base.map((a) => a.email)]);
  const cc = [...m.to, ...m.cc].filter((a) => {
    if (seen.has(a.email)) return false;
    seen.add(a.email);
    return true;
  }).map(fmtAddr);
  return { to, cc };
}

export function quoteHtml(m: MessageDetail): string {
  const header = `On ${escapeHtml(fullDate(m.date))}, ${escapeHtml(displayName(m.from))} &lt;${escapeHtml(m.from.email)}&gt; wrote:`;
  const body = m.bodyText ? escapeHtml(m.bodyText).replace(/\n/g, "<br>") : "";
  return `<br><div class="gmail_quote"><div>${header}</div><blockquote type="cite" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote></div>`;
}

export function forwardHtml(m: MessageDetail): string {
  const lines = [
    "---------- Forwarded message ---------",
    `From: ${fmtAddr(m.from)}`,
    `Date: ${fullDate(m.date)}`,
    `Subject: ${m.subject}`,
    `To: ${m.to.map(fmtAddr).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(fmtAddr).join(", ")}`] : []),
  ].map(escapeHtml);
  const body = m.bodyText ? escapeHtml(m.bodyText).replace(/\n/g, "<br>") : "";
  return `<br><div class="gmail_quote">${lines.join("<br>")}<br><br>${body}</div>`;
}

export function htmlToPlain(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, "$&\n");
  return (div.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function textToParagraphs(text: string): string {
  return text.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export function splitAddresses(s: string): string[] {
  return s.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

export const EMAIL_RE = /^(?:[^<>@\s]+\s*)?<?[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>?$/;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
