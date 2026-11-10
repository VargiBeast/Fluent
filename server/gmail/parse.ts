import type { Address, AttachmentMeta, MessageDetail, ThreadSummary } from "../../shared/mail.js";

export interface GmailHeader { name: string; value: string }
export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
}
export interface GmailThread { id: string; historyId?: string; messages?: GmailMessage[] }

export function header(part: GmailPart | undefined, name: string): string {
  const n = name.toLowerCase();
  return part?.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
}

/** Parse an RFC 5322 address list, tolerating quoted names containing commas. */
export function parseAddresses(value: string): Address[] {
  const out: Address[] = [];
  let buf = "";
  let quoted = false;
  let angle = 0;
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "<") angle++;
    if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) {
      if (buf.trim()) out.push(parseAddress(buf));
      buf = "";
    } else buf += ch;
  }
  if (buf.trim()) out.push(parseAddress(buf));
  return out.filter((a) => a.email || a.name);
}

export function parseAddress(raw: string): Address {
  const s = raw.trim();
  const m = /^(.*)<([^>]+)>\s*$/.exec(s);
  if (m) {
    const name = m[1]!.trim().replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
    const email = m[2]!.trim().toLowerCase();
    return { name: name || email, email };
  }
  const email = s.replace(/^"|"$/g, "").toLowerCase();
  return { name: email, email };
}

export function decodeB64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function charsetOf(part: GmailPart): string {
  return /charset="?([^";]+)"?/i.exec(header(part, "Content-Type"))?.[1]?.toLowerCase() ?? "utf-8";
}

function decodeText(part: GmailPart): string {
  const buf = decodeB64Url(part.body?.data ?? "");
  const cs = charsetOf(part);
  try {
    return new TextDecoder(cs === "us-ascii" ? "utf-8" : cs).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

interface Walk { html: string[]; text: string[]; attachments: AttachmentMeta[] }

function walk(part: GmailPart, messageId: string, acc: Walk): void {
  const mime = (part.mimeType ?? "").toLowerCase();
  const filename = part.filename ?? "";
  const disposition = header(part, "Content-Disposition").toLowerCase();
  if (part.body?.attachmentId || (filename && part.body?.data)) {
    const cid = header(part, "Content-ID").replace(/[<>]/g, "") || null;
    acc.attachments.push({
      attachmentId: part.body?.attachmentId ?? "",
      messageId,
      filename: filename || (cid ? `inline-${cid}` : "attachment"),
      mimeType: mime || "application/octet-stream",
      size: part.body?.size ?? 0,
      contentId: cid,
      inline: Boolean(cid) && !disposition.startsWith("attachment"),
    });
    return;
  }
  if (part.parts?.length) {
    if (mime === "multipart/alternative") {
      // Prefer the richest alternative, but keep a text version for AI/plain rendering.
      const html = part.parts.find((p) => p.mimeType === "text/html");
      const text = part.parts.find((p) => p.mimeType === "text/plain");
      const others = part.parts.filter((p) => p !== html && p !== text);
      if (html) acc.html.push(decodeText(html));
      if (text) acc.text.push(decodeText(text));
      for (const o of others) walk(o, messageId, acc);
      return;
    }
    for (const p of part.parts) walk(p, messageId, acc);
    return;
  }
  if (mime === "text/html") acc.html.push(decodeText(part));
  else if (mime === "text/plain" || mime === "") acc.text.push(decodeText(part));
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export function parseMessage(m: GmailMessage, accountEmail: string): MessageDetail {
  const acc: Walk = { html: [], text: [], attachments: [] };
  if (m.payload) walk(m.payload, m.id, acc);
  const from = parseAddress(header(m.payload, "From") || "unknown");
  const labels = m.labelIds ?? [];
  const html = acc.html.length ? acc.html.join("<hr>") : null;
  const text = acc.text.length ? acc.text.join("\n\n") : html ? htmlToText(html) : null;
  return {
    id: m.id,
    threadId: m.threadId,
    from,
    to: parseAddresses(header(m.payload, "To")),
    cc: parseAddresses(header(m.payload, "Cc")),
    bcc: parseAddresses(header(m.payload, "Bcc")),
    replyTo: parseAddresses(header(m.payload, "Reply-To")),
    date: new Date(Number(m.internalDate ?? Date.parse(header(m.payload, "Date")) ?? Date.now())).toISOString(),
    subject: header(m.payload, "Subject"),
    messageIdHeader: header(m.payload, "Message-ID") || header(m.payload, "Message-Id"),
    references: header(m.payload, "References"),
    snippet: decodeEntities(m.snippet ?? ""),
    bodyHtml: html,
    bodyText: text,
    attachments: acc.attachments,
    labelIds: labels,
    unread: labels.includes("UNREAD"),
    isFromMe: from.email === accountEmail.toLowerCase() || labels.includes("SENT"),
    isDraft: labels.includes("DRAFT"),
  };
}

export function decodeEntities(s: string): string {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function hasAttachmentPart(p: GmailPart | undefined): boolean {
  if (!p) return false;
  if (p.filename && (p.body?.attachmentId || p.body?.data)) return true;
  return (p.parts ?? []).some(hasAttachmentPart);
}

/** Build a list row from a thread fetched with format=metadata. */
export function summarizeThread(t: GmailThread, accountId: string, accountEmail: string): ThreadSummary {
  const msgs = (t.messages ?? []).filter((m) => !(m.labelIds ?? []).includes("DRAFT") || (t.messages ?? []).length === 1);
  const all = t.messages ?? [];
  const last = msgs[msgs.length - 1] ?? all[all.length - 1];
  const first = all[0];
  const me = accountEmail.toLowerCase();
  const participants: Address[] = [];
  for (const m of msgs) {
    const a = parseAddress(header(m.payload, "From") || "unknown");
    if (!participants.some((p) => p.email === a.email)) participants.push(a);
  }
  const labelSet = new Set(all.flatMap((m) => m.labelIds ?? []));
  const lastFrom = parseAddress(header(last?.payload, "From") || "unknown");
  const others = participants.filter((p) => p.email !== me);
  const display = lastFrom.email === me && others.length ? others[others.length - 1]! : lastFrom;
  return {
    id: t.id,
    accountId,
    subject: header(first?.payload, "Subject") || "(no subject)",
    snippet: decodeEntities(last?.snippet ?? ""),
    participants,
    from: display,
    lastDate: new Date(Number(last?.internalDate ?? Date.now())).toISOString(),
    messageCount: msgs.length,
    unread: all.some((m) => (m.labelIds ?? []).includes("UNREAD")),
    starred: labelSet.has("STARRED"),
    important: labelSet.has("IMPORTANT"),
    hasAttachments: all.some((m) => hasAttachmentPart(m.payload)),
    labelIds: [...labelSet],
    lastFromMe: lastFrom.email === me || (last?.labelIds ?? []).includes("SENT"),
  };
}
