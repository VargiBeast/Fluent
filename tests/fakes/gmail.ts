/** In-memory fake of the Gmail REST API (users.me.*) used by tests and the E2E harness. */
import { randomBytes } from "node:crypto";
import { parseMime, type FakePart } from "./mime.js";
import { seedMessages, type SeedMessage } from "./seed.js";

interface Msg {
  id: string;
  threadId: string;
  labelIds: Set<string>;
  internalDate: number;
  payload: FakePart;
  snippet: string;
  historyId: number;
}

interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  color?: { backgroundColor: string; textColor: string };
}

export interface Mailbox {
  email: string;
  name: string;
  messages: Map<string, Msg>;
  labels: Map<string, Label>;
  drafts: Map<string, string>; // draftId -> messageId
  filters: Map<string, { id: string; criteria: Record<string, unknown>; action: Record<string, unknown> }>;
  attachments: Map<string, Buffer>;
  historyId: number;
  history: Array<{ id: number; messageId: string; threadId: string; type: "added" | "labels" | "deleted" }>;
  sent: string[]; // raw messages sent (for assertions)
}

const SYSTEM_LABELS = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED", "IMPORTANT", "UNREAD", "CHAT",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

const id = () => randomBytes(8).toString("hex");

type R = { status: number; body?: unknown };
const err = (status: number, message: string): R => ({ status, body: { error: { code: status, message } } });

function headerOf(p: FakePart, name: string): string {
  return p.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function textOf(p: FakePart): string {
  if (p.parts) return p.parts.map(textOf).join(" ");
  if (p.body.data && p.mimeType.startsWith("text/")) {
    const t = Buffer.from(p.body.data, "base64url").toString("utf8");
    return p.mimeType === "text/html" ? t.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ") : t;
  }
  return "";
}

function hasAttachment(p: FakePart): boolean {
  return Boolean(p.filename) || (p.parts ?? []).some(hasAttachment);
}

export class FakeGmail {
  private boxes = new Map<string, Mailbox>();

  has(email: string): boolean {
    return this.boxes.has(email);
  }

  mailbox(email: string): Mailbox {
    let b = this.boxes.get(email);
    if (!b) {
      b = { email, name: email, messages: new Map(), labels: new Map(), drafts: new Map(), filters: new Map(), attachments: new Map(), historyId: 1000, history: [], sent: [] };
      for (const l of SYSTEM_LABELS) b.labels.set(l, { id: l, name: l, type: "system" });
      this.boxes.set(email, b);
    }
    return b;
  }

  seedDefault(email: string, name: string): void {
    const b = this.mailbox(email);
    b.name = name;
    for (const [lid, lname] of [["Label_1", "Clients"], ["Label_2", "Travel"], ["Label_3", "Receipts"]] as const) {
      b.labels.set(lid, { id: lid, name: lname, type: "user", color: { backgroundColor: "#8e63ce", textColor: "#ffffff" } });
    }
    for (const m of seedMessages(email, name)) this.insertSeed(b, m);
  }

  insertSeed(b: Mailbox, m: SeedMessage): string {
    const parsed = parseMime(m.raw, "", b.attachments);
    const msg: Msg = {
      id: m.id ?? id(),
      threadId: m.threadId,
      labelIds: new Set(m.labels),
      internalDate: m.date.getTime(),
      payload: parsed,
      snippet: textOf(parsed).replace(/\s+/g, " ").trim().slice(0, 140),
      historyId: ++b.historyId,
    };
    b.messages.set(msg.id, msg);
    return msg.id;
  }

  private bump(b: Mailbox, m: Msg, type: "added" | "labels" | "deleted") {
    b.historyId += 1;
    m.historyId = b.historyId;
    b.history.push({ id: b.historyId, messageId: m.id, threadId: m.threadId, type });
  }

  /** Deliver a new inbound message (used by tests to simulate new mail). */
  deliver(email: string, raw: string, threadId?: string): string {
    const b = this.mailbox(email);
    const mid = this.insertSeed(b, { raw, threadId: threadId ?? id(), labels: ["INBOX", "UNREAD", "CATEGORY_PERSONAL"], date: new Date() });
    this.bump(b, b.messages.get(mid)!, "added");
    return mid;
  }

  private threadMessages(b: Mailbox, threadId: string): Msg[] {
    return [...b.messages.values()].filter((m) => m.threadId === threadId).sort((a, z) => a.internalDate - z.internalDate);
  }

  private matches(b: Mailbox, m: Msg, q: string): boolean {
    const tokens = q.match(/-?[a-z_]+:\([^)]*\)|-?[a-z_]+:"[^"]*"|-?[a-z_]+:\S+|"[^"]+"|\S+/gi) ?? [];
    const from = headerOf(m.payload, "From").toLowerCase();
    const to = (headerOf(m.payload, "To") + " " + headerOf(m.payload, "Cc")).toLowerCase();
    const subject = headerOf(m.payload, "Subject").toLowerCase();
    const text = `${subject} ${from} ${to} ${textOf(m.payload)}`.toLowerCase();
    const labels = m.labelIds;
    const userLabelByName = (n: string) => [...b.labels.values()].find((l) => l.name.toLowerCase().replace(/\s+/g, "-") === n.toLowerCase());
    for (const raw of tokens) {
      if (raw.toUpperCase() === "OR" || raw.toUpperCase() === "AND") continue;
      const neg = raw.startsWith("-");
      const t = neg ? raw.slice(1) : raw;
      const [op = "", ...rest] = t.includes(":") ? t.split(":") : ["", t];
      const val = rest.join(":").replace(/^["(]|[")]$/g, "").toLowerCase();
      let ok: boolean;
      switch (op.toLowerCase()) {
        case "from": ok = val === "me" ? from.includes(b.email) : from.includes(val); break;
        case "to": ok = val === "me" ? to.includes(b.email) : to.includes(val); break;
        case "subject": ok = subject.includes(val); break;
        case "in": {
          const map: Record<string, string> = { inbox: "INBOX", sent: "SENT", trash: "TRASH", spam: "SPAM", drafts: "DRAFT", draft: "DRAFT", chats: "CHAT", starred: "STARRED", important: "IMPORTANT" };
          ok = val === "anywhere" || val === "all" ? true : labels.has(map[val] ?? val.toUpperCase());
          break;
        }
        case "is": {
          const map: Record<string, string> = { unread: "UNREAD", starred: "STARRED", important: "IMPORTANT" };
          ok = val === "read" ? !labels.has("UNREAD") : labels.has(map[val] ?? val.toUpperCase());
          break;
        }
        case "has": ok = val === "attachment" ? hasAttachment(m.payload) : false; break;
        case "filename": ok = JSON.stringify(m.payload).toLowerCase().includes(val); break;
        case "label": {
          const l = userLabelByName(val);
          ok = l ? labels.has(l.id) : labels.has(val.toUpperCase());
          break;
        }
        case "category": ok = labels.has(`CATEGORY_${val === "primary" ? "PERSONAL" : val.toUpperCase()}`); break;
        case "after": case "newer": ok = m.internalDate >= Date.parse(val.replace(/\//g, "-")); break;
        case "before": case "older": ok = m.internalDate < Date.parse(val.replace(/\//g, "-")); break;
        case "newer_than": case "older_than": {
          const mm = /^(\d+)([dmy])$/.exec(val);
          const days = mm ? Number(mm[1]) * (mm[2] === "d" ? 1 : mm[2] === "m" ? 30 : 365) : 0;
          const cutoff = Date.now() - days * 86400_000;
          ok = op.toLowerCase() === "newer_than" ? m.internalDate >= cutoff : m.internalDate < cutoff;
          break;
        }
        default: ok = text.includes(val.replace(/^"|"$/g, ""));
      }
      if (neg ? ok : !ok) return false;
    }
    return true;
  }

  private threadResource(b: Mailbox, threadId: string, format: string, metadataHeaders: string[]) {
    const msgs = this.threadMessages(b, threadId);
    return {
      id: threadId,
      historyId: String(Math.max(...msgs.map((m) => m.historyId))),
      messages: msgs.map((m) => this.messageResource(m, format, metadataHeaders)),
    };
  }

  private messageResource(m: Msg, format: string, metadataHeaders: string[]) {
    const base = { id: m.id, threadId: m.threadId, labelIds: [...m.labelIds], snippet: m.snippet, historyId: String(m.historyId), internalDate: String(m.internalDate), sizeEstimate: 1000 };
    if (format === "minimal") return base;
    if (format === "metadata") {
      const wanted = metadataHeaders.map((h) => h.toLowerCase());
      return {
        ...base,
        payload: {
          mimeType: m.payload.mimeType,
          headers: m.payload.headers.filter((h) => wanted.length === 0 || wanted.includes(h.name.toLowerCase())),
          parts: hasAttachment(m.payload) ? [{ mimeType: "application/octet-stream", filename: "x", body: { size: 1, attachmentId: "x" } }] : undefined,
        },
      };
    }
    return { ...base, payload: m.payload };
  }

  private newMessageFromRaw(b: Mailbox, raw: string, threadId: string | undefined, labels: string[]): Msg {
    const src = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = parseMime(src, "", b.attachments);
    // Gmail threads replies by References/In-Reply-To + subject when threadId is supplied.
    const tid = threadId && [...b.messages.values()].some((m) => m.threadId === threadId) ? threadId : id();
    const msg: Msg = { id: id(), threadId: tid, labelIds: new Set(labels), internalDate: Date.now(), payload: parsed, snippet: textOf(parsed).replace(/\s+/g, " ").trim().slice(0, 140), historyId: 0 };
    b.messages.set(msg.id, msg);
    this.bump(b, msg, "added");
    return msg;
  }

  handle(email: string, method: string, path: string, qs: URLSearchParams, rawBody?: string): R {
    const b = this.mailbox(email);
    const body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    const seg = path.split("/").filter(Boolean);

    if (method === "GET" && seg[0] === "profile") {
      return { status: 200, body: { emailAddress: b.email, messagesTotal: b.messages.size, threadsTotal: new Set([...b.messages.values()].map((m) => m.threadId)).size, historyId: String(b.historyId) } };
    }

    if (seg[0] === "threads") {
      if (method === "GET" && seg.length === 1) {
        const q = qs.get("q") ?? "";
        const labelIds = qs.getAll("labelIds");
        const includeSpamTrash = qs.get("includeSpamTrash") === "true" || /\bin:(trash|spam)\b/.test(q) || labelIds.includes("TRASH") || labelIds.includes("SPAM");
        const max = Math.min(Number(qs.get("maxResults") ?? 100), 500);
        const start = Number(qs.get("pageToken") ?? 0);
        const byThread = new Map<string, number>();
        for (const m of b.messages.values()) {
          if (!includeSpamTrash && (m.labelIds.has("TRASH") || m.labelIds.has("SPAM"))) continue;
          if (labelIds.some((l) => !m.labelIds.has(l))) continue;
          if (q && !this.matches(b, m, q)) continue;
          byThread.set(m.threadId, Math.max(byThread.get(m.threadId) ?? 0, m.internalDate));
        }
        // Order threads by their latest message (any label), like Gmail.
        const ordered = [...byThread.keys()].map((t) => ({ t, d: Math.max(...this.threadMessages(b, t).map((m) => m.internalDate)) })).sort((a, z) => z.d - a.d);
        const page = ordered.slice(start, start + max);
        return {
          status: 200,
          body: {
            threads: page.length ? page.map(({ t }) => { const ms = this.threadMessages(b, t); return { id: t, snippet: ms[ms.length - 1]!.snippet, historyId: String(ms[ms.length - 1]!.historyId) }; }) : undefined,
            nextPageToken: start + max < ordered.length ? String(start + max) : undefined,
            resultSizeEstimate: ordered.length,
          },
        };
      }
      const tid = seg[1]!;
      const msgs = this.threadMessages(b, tid);
      if (msgs.length === 0) return err(404, "Requested entity was not found.");
      if (method === "GET" && seg.length === 2) {
        return { status: 200, body: this.threadResource(b, tid, qs.get("format") ?? "full", qs.getAll("metadataHeaders")) };
      }
      if (method === "POST" && seg[2] === "modify") {
        const add = (body.addLabelIds as string[] | undefined) ?? [];
        const remove = (body.removeLabelIds as string[] | undefined) ?? [];
        for (const l of [...add, ...remove]) if (!b.labels.has(l)) return err(400, `Invalid label: ${l}`);
        for (const m of msgs) {
          for (const l of add) m.labelIds.add(l);
          for (const l of remove) m.labelIds.delete(l);
          this.bump(b, m, "labels");
        }
        return { status: 200, body: this.threadResource(b, tid, "minimal", []) };
      }
      if (method === "POST" && (seg[2] === "trash" || seg[2] === "untrash")) {
        for (const m of msgs) {
          if (seg[2] === "trash") m.labelIds.add("TRASH");
          else m.labelIds.delete("TRASH");
          this.bump(b, m, "labels");
        }
        return { status: 200, body: this.threadResource(b, tid, "minimal", []) };
      }
      if (method === "DELETE") {
        for (const m of msgs) {
          b.messages.delete(m.id);
          this.bump(b, m, "deleted");
        }
        return { status: 204 };
      }
    }

    if (seg[0] === "messages") {
      if (method === "POST" && seg[1] === "send") {
        const raw = String(body.raw ?? "");
        if (!raw) return err(400, "Missing raw");
        b.sent.push(Buffer.from(raw, "base64url").toString("utf8"));
        const m = this.newMessageFromRaw(b, raw, body.threadId as string | undefined, ["SENT"]);
        return { status: 200, body: { id: m.id, threadId: m.threadId, labelIds: [...m.labelIds] } };
      }
      const m = b.messages.get(seg[1] ?? "");
      if (!m) return err(404, "Requested entity was not found.");
      if (method === "GET" && seg[2] === "attachments") {
        const data = b.attachments.get(seg[3] ?? "");
        if (!data) return err(404, "Attachment not found");
        return { status: 200, body: { size: data.length, data: data.toString("base64url") } };
      }
      if (method === "GET" && seg.length === 2) return { status: 200, body: this.messageResource(m, qs.get("format") ?? "full", qs.getAll("metadataHeaders")) };
    }

    if (seg[0] === "drafts") {
      if (method === "GET" && seg.length === 1) {
        const drafts = [...b.drafts.entries()].map(([did, mid]) => ({ id: did, message: { id: mid, threadId: b.messages.get(mid)?.threadId } }))
          .sort((a, z) => (b.messages.get(z.message.id)?.internalDate ?? 0) - (b.messages.get(a.message.id)?.internalDate ?? 0));
        return { status: 200, body: { drafts: drafts.length ? drafts : undefined, resultSizeEstimate: drafts.length } };
      }
      if (method === "POST" && seg[1] === "send") {
        const did = String(body.id ?? "");
        const mid = b.drafts.get(did);
        if (!mid) return err(404, "Draft not found");
        const m = b.messages.get(mid)!;
        m.labelIds.delete("DRAFT");
        m.labelIds.add("SENT");
        m.internalDate = Date.now();
        b.drafts.delete(did);
        this.bump(b, m, "labels");
        return { status: 200, body: { id: m.id, threadId: m.threadId, labelIds: [...m.labelIds] } };
      }
      if (method === "POST" && seg.length === 1) {
        const msg = body.message as { raw?: string; threadId?: string } | undefined;
        if (!msg?.raw) return err(400, "Missing message.raw");
        const m = this.newMessageFromRaw(b, msg.raw, msg.threadId, ["DRAFT"]);
        const did = `r-${id()}`;
        b.drafts.set(did, m.id);
        return { status: 200, body: { id: did, message: { id: m.id, threadId: m.threadId, labelIds: ["DRAFT"] } } };
      }
      const did = seg[1] ?? "";
      const mid = b.drafts.get(did);
      if (!mid) return err(404, "Draft not found");
      if (method === "GET") return { status: 200, body: { id: did, message: this.messageResource(b.messages.get(mid)!, qs.get("format") ?? "full", []) } };
      if (method === "PUT") {
        const msg = body.message as { raw?: string; threadId?: string } | undefined;
        if (!msg?.raw) return err(400, "Missing message.raw");
        const old = b.messages.get(mid)!;
        b.messages.delete(mid);
        const m = this.newMessageFromRaw(b, msg.raw, msg.threadId ?? old.threadId, ["DRAFT"]);
        b.drafts.set(did, m.id);
        return { status: 200, body: { id: did, message: { id: m.id, threadId: m.threadId, labelIds: ["DRAFT"] } } };
      }
      if (method === "DELETE") {
        b.messages.delete(mid);
        b.drafts.delete(did);
        return { status: 204 };
      }
    }

    if (seg[0] === "labels") {
      const counts = (l: Label) => {
        const ms = [...b.messages.values()].filter((m) => m.labelIds.has(l.id));
        const threads = new Set(ms.map((m) => m.threadId));
        const unreadThreads = new Set(ms.filter((m) => m.labelIds.has("UNREAD")).map((m) => m.threadId));
        return { messagesTotal: ms.length, messagesUnread: ms.filter((m) => m.labelIds.has("UNREAD")).length, threadsTotal: threads.size, threadsUnread: unreadThreads.size };
      };
      if (method === "GET" && seg.length === 1) return { status: 200, body: { labels: [...b.labels.values()] } };
      if (method === "POST" && seg.length === 1) {
        const name = String(body.name ?? "").trim();
        if (!name) return err(400, "Invalid label name");
        if ([...b.labels.values()].some((l) => l.name.toLowerCase() === name.toLowerCase())) return err(409, "Label name exists or conflicts");
        const l: Label = { id: `Label_${id().slice(0, 6)}`, name, type: "user", color: body.color as Label["color"] };
        b.labels.set(l.id, l);
        return { status: 200, body: l };
      }
      const l = b.labels.get(seg[1] ?? "");
      if (!l) return err(404, "Label not found");
      if (method === "GET") return { status: 200, body: { ...l, ...counts(l) } };
      if (l.type === "system") return err(400, "Invalid label");
      if (method === "PATCH" || method === "PUT") {
        if (typeof body.name === "string") l.name = body.name;
        if (body.color) l.color = body.color as Label["color"];
        return { status: 200, body: l };
      }
      if (method === "DELETE") {
        b.labels.delete(l.id);
        for (const m of b.messages.values()) m.labelIds.delete(l.id);
        return { status: 204 };
      }
    }

    if (seg[0] === "settings" && seg[1] === "filters") {
      if (method === "GET" && seg.length === 2) return { status: 200, body: { filter: b.filters.size ? [...b.filters.values()] : undefined } };
      if (method === "POST") {
        const f = { id: `ANe1Bm${id()}`, criteria: (body.criteria as Record<string, unknown>) ?? {}, action: (body.action as Record<string, unknown>) ?? {} };
        b.filters.set(f.id, f);
        return { status: 200, body: f };
      }
      if (method === "DELETE") {
        if (!b.filters.delete(seg[2] ?? "")) return err(404, "Filter not found");
        return { status: 204 };
      }
    }

    if (method === "GET" && seg[0] === "history") {
      const start = Number(qs.get("startHistoryId") ?? 0);
      if (start < 1000) return err(404, "Requested entity was not found.");
      const items = b.history.filter((h) => h.id > start);
      return {
        status: 200,
        body: {
          history: items.length ? items.map((h) => ({
            id: String(h.id),
            messages: [{ id: h.messageId, threadId: h.threadId }],
            ...(h.type === "added" ? { messagesAdded: [{ message: { id: h.messageId, threadId: h.threadId, labelIds: [...(b.messages.get(h.messageId)?.labelIds ?? [])] } }] } : {}),
          })) : undefined,
          historyId: String(b.historyId),
        },
      };
    }

    return err(404, `Fake Gmail: unsupported ${method} ${path}`);
  }
}
