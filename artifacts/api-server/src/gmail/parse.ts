export interface ParsedAddress {
  name: string | null;
  email: string;
}

export interface ParsedAttachment {
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  externalId: string | null;
}

export interface ParsedMessage {
  externalId: string;
  from: ParsedAddress;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string;
  internalDate: Date;
  labels: string[];
  isUnread: boolean;
  isStarred: boolean;
  attachments: ParsedAttachment[];
}

interface Header {
  name?: string;
  value?: string;
}

interface Part {
  mimeType?: string;
  filename?: string;
  headers?: Header[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: Part[];
}

export interface GmailThreadResource {
  id?: string;
  historyId?: string;
  snippet?: string;
  messages?: GmailMessageResource[];
}

export interface GmailMessageResource {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: Part;
}

export function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function headerMap(headers: Header[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const header of headers ?? []) {
    if (!header.name || header.value == null) continue;
    map.set(header.name.toLowerCase(), header.value);
  }
  return map;
}

export function parseAddress(raw: string | undefined): ParsedAddress {
  const value = raw?.trim() || "unknown@example.invalid";
  const match = value.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    return { name: match[1]?.trim() || null, email: match[2].trim() };
  }
  if (value.includes("@")) return { name: null, email: value };
  return { name: value, email: "unknown@example.invalid" };
}

export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => parseAddress(part).email)
    .filter((email) => email.includes("@"))
    .slice(0, 50);
}

function collectBodies(part: Part | undefined, found: { text: string; html: string; attachments: ParsedAttachment[] }): void {
  if (!part) return;
  const mime = part.mimeType ?? "";
  if (part.filename && (part.body?.attachmentId || (part.body?.size ?? 0) > 0)) {
    found.attachments.push({
      filename: part.filename.slice(0, 240),
      mimeType: mime || null,
      sizeBytes: part.body?.size ?? null,
      externalId: part.body?.attachmentId ?? null,
    });
  } else if (mime === "text/plain" && !found.text) {
    found.text = decodeBase64Url(part.body?.data).slice(0, 100_000);
  } else if (mime === "text/html" && !found.html) {
    found.html = decodeBase64Url(part.body?.data).slice(0, 100_000);
  }
  for (const child of part.parts ?? []) collectBodies(child, found);
}

export function parseGmailMessage(message: GmailMessageResource): ParsedMessage {
  const headers = headerMap(message.payload?.headers);
  const bodies = { text: "", html: "", attachments: [] as ParsedAttachment[] };
  collectBodies(message.payload, bodies);
  const labels = message.labelIds ?? [];
  const internalMs = Number(message.internalDate ?? Date.now());
  const from = parseAddress(headers.get("from"));
  return {
    externalId: message.id ?? "",
    from,
    to: parseAddressList(headers.get("to")),
    cc: parseAddressList(headers.get("cc")),
    subject: (headers.get("subject") ?? "").slice(0, 500),
    snippet: (message.snippet ?? "").slice(0, 500),
    bodyText: bodies.text,
    bodyHtml: bodies.html,
    internalDate: new Date(Number.isFinite(internalMs) ? internalMs : Date.now()),
    labels,
    isUnread: labels.includes("UNREAD"),
    isStarred: labels.includes("STARRED"),
    attachments: bodies.attachments.slice(0, 20),
  };
}

export function categoryFromLabels(labels: string[]): string | null {
  const found = labels.find((label) => label.startsWith("CATEGORY_"));
  return found ? found.replace("CATEGORY_", "").toLowerCase() : null;
}

export function needsReply(lastFrom: string, userEmail: string, labels: string[]): boolean {
  return (
    labels.includes("INBOX") &&
    labels.includes("UNREAD") &&
    !labels.includes("TRASH") &&
    lastFrom.toLowerCase() !== userEmail.toLowerCase()
  );
}
