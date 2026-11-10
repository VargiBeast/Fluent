import { GmailClient, mapLimit } from "../gmail/client.js";
import { header, parseAddress, type GmailMessage } from "../gmail/parse.js";
import { buildMime, formatAddress, toBase64Url } from "../gmail/mime.js";
import { HttpError, badRequest } from "../lib/errors.js";
import { parseListUnsubscribe } from "../lib/listUnsubscribe.js";
import { postOneClick } from "../lib/oneClick.js";
import { logger } from "../logger.js";
import {
  UNSUB_LIMITS, compareSenders, type ArchiveResult, type NewsletterScan, type NewsletterSender, type UnsubActionResult, type UnsubRange,
} from "../../shared/unsubscribe.js";
import { getOwnedAccount, logSecurityEvent, type AccountRow } from "./accounts.js";
import { assertGmailId, resolveAccounts } from "./mail.js";
import { senderDisplayName } from "./sendas.js";

const HEADERS = ["From", "Date", "List-Unsubscribe", "List-Unsubscribe-Post"];

interface ScanMessage { accountId: string; id: string; from: string; name: string; at: number; unread: boolean; inInbox: boolean; listUnsubscribe: string; listUnsubscribePost: string }

async function listMessageIds(gm: GmailClient, q: string, max: number): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await gm.request<{ messages?: Array<{ id: string }>; nextPageToken?: string }>("GET", "/messages", {
      query: { q, maxResults: Math.min(500, max - ids.length), pageToken },
    });
    for (const m of r.messages ?? []) ids.push(m.id);
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < max);
  return { ids: ids.slice(0, max), truncated: Boolean(pageToken) || ids.length > max };
}

/** Pure: group newsletter messages by sender and rank least-opened first. */
export function groupSenders(messages: ScanMessage[]): NewsletterSender[] {
  const groups = new Map<string, ScanMessage[]>();
  for (const m of messages) {
    if (!m.from) continue;
    const key = `${m.accountId}\n${m.from}`;
    const g = groups.get(key);
    if (g) g.push(m);
    else groups.set(key, [m]);
  }
  const out: NewsletterSender[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => b.at - a.at);
    const latest = list.find((m) => parseListUnsubscribe(m.listUnsubscribe, m.listUnsubscribePost));
    if (!latest) continue;
    const p = parseListUnsubscribe(latest.listUnsubscribe, latest.listUnsubscribePost)!;
    const unread = list.filter((m) => m.unread).length;
    out.push({
      accountId: latest.accountId,
      email: latest.from,
      name: list.find((m) => m.name && m.name !== m.from)?.name ?? latest.from,
      total: list.length,
      read: list.length - unread,
      unread,
      openRate: (list.length - unread) / list.length,
      inInbox: list.filter((m) => m.inInbox).length,
      lastAt: new Date(list[0]!.at).toISOString(),
      messageId: latest.id,
      methods: {
        oneClick: Boolean(p.oneClickUrl),
        mailto: p.mailto ? { address: p.mailto.address, subject: p.mailto.subject } : null,
        link: p.oneClickUrl ? null : p.httpsUrl,
      },
    });
  }
  return out.sort(compareSenders);
}

/** Reads message metadata only (From, Date, unsubscribe headers and labels). Nothing is stored. */
export async function scanNewsletters(userId: string, p: { days: UnsubRange; account?: string }): Promise<NewsletterScan> {
  const accs = await resolveAccounts(userId, p.account);
  const errors: NewsletterScan["errors"] = [];
  const messages: ScanMessage[] = [];
  let scanned = 0;
  let truncated = false;
  for (const a of accs) {
    const gm = new GmailClient(a);
    try {
      const list = await listMessageIds(gm, `newer_than:${p.days}d -in:sent -in:drafts -in:chats`, UNSUB_LIMITS.messagesPerAccount);
      truncated ||= list.truncated;
      scanned += list.ids.length;
      const got = await mapLimit(list.ids, 10, async (id) => {
        try {
          return await gm.request<GmailMessage>("GET", `/messages/${id}`, { query: { format: "metadata", metadataHeaders: HEADERS } });
        } catch (err) {
          if (err instanceof HttpError && err.status === 404) return null;
          throw err;
        }
      });
      for (const m of got) {
        if (!m) continue;
        const lu = header(m.payload, "List-Unsubscribe");
        if (!lu) continue;
        const from = parseAddress(header(m.payload, "From"));
        const labels = m.labelIds ?? [];
        messages.push({
          accountId: a.id, id: m.id, from: from.email, name: from.name, at: Number(m.internalDate ?? 0) || Date.parse(header(m.payload, "Date")) || 0,
          unread: labels.includes("UNREAD"), inInbox: labels.includes("INBOX"), listUnsubscribe: lu, listUnsubscribePost: header(m.payload, "List-Unsubscribe-Post"),
        });
      }
    } catch (err) {
      errors.push({ accountId: a.id, code: err instanceof HttpError ? err.code : "error", message: err instanceof HttpError ? err.message : "Could not load this account." });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    days: p.days,
    senders: groupSenders(messages),
    sample: { messages: scanned, limit: UNSUB_LIMITS.messagesPerAccount, truncated },
    errors,
  };
}

async function unsubscribeHeaders(acc: AccountRow, messageId: string) {
  const gm = new GmailClient(acc);
  const m = await gm.request<GmailMessage>("GET", `/messages/${assertGmailId(messageId, "message")}`, { query: { format: "metadata", metadataHeaders: HEADERS } });
  const parsed = parseListUnsubscribe(header(m.payload, "List-Unsubscribe"), header(m.payload, "List-Unsubscribe-Post"));
  return { gm, parsed, from: parseAddress(header(m.payload, "From")).email };
}

const domainOf = (email: string) => email.split("@")[1] ?? "";

/**
 * Unsubscribe after the user's explicit click. The header is re-read from Gmail here; the client never
 * supplies the URL or address.
 */
export async function unsubscribe(userId: string, accountId: string, messageId: string, method: "one-click" | "mailto"): Promise<UnsubActionResult> {
  const acc = await getOwnedAccount(userId, accountId);
  const { gm, parsed, from } = await unsubscribeHeaders(acc, messageId);
  if (method === "one-click") {
    if (!parsed?.oneClickUrl) throw badRequest("This sender doesn't support one-click unsubscribe.");
    const r = await postOneClick(parsed.oneClickUrl);
    if (!r.ok) {
      logger.warn({ reason: r.reason, status: r.ok ? undefined : r.status }, "one_click_unsubscribe_failed");
      throw new HttpError(502, "unsubscribe_failed", r.reason === "blocked"
        ? "This sender's unsubscribe address isn't allowed. Use their unsubscribe link instead."
        : "The sender's unsubscribe service didn't accept the request. Try again later or use their unsubscribe link.");
    }
  } else {
    if (!parsed?.mailto) throw badRequest("This sender doesn't offer email unsubscribe.");
    const { address, subject, body } = parsed.mailto;
    const text = body || "Please unsubscribe me from this mailing list.";
    const raw = buildMime({
      from: formatAddress(await senderDisplayName(gm), acc.email),
      to: [address], cc: [], bcc: [], subject,
      text,
      html: `<p>${text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)}</p>`,
      attachments: [],
    });
    await gm.request("POST", "/messages/send", { body: { raw: toBase64Url(raw) } });
  }
  await logSecurityEvent(userId, "newsletter_unsubscribed", `${method} ${domainOf(from)}`);
  return { ok: true, method, sender: from };
}

/** Archive every Inbox message from these senders (explicit user click). Returns the ids so it can be undone. */
export async function archiveSenders(userId: string, senders: Array<{ accountId: string; email: string }>): Promise<ArchiveResult> {
  const undo: ArchiveResult["undo"] = [];
  let archived = 0;
  const byAccount = new Map<string, string[]>();
  for (const s of senders) byAccount.set(s.accountId, [...new Set([...(byAccount.get(s.accountId) ?? []), s.email])]);
  for (const [accountId, emails] of byAccount) {
    const acc = await getOwnedAccount(userId, accountId);
    const gm = new GmailClient(acc);
    const ids: string[] = [];
    for (const email of emails) ids.push(...(await listMessageIds(gm, `from:${email} in:inbox`, UNSUB_LIMITS.messagesPerSender)).ids);
    const unique = [...new Set(ids)];
    for (let i = 0; i < unique.length; i += 1000) {
      await gm.request("POST", "/messages/batchModify", { body: { ids: unique.slice(i, i + 1000), removeLabelIds: ["INBOX"] } });
    }
    archived += unique.length;
    if (unique.length) undo.push({ accountId: acc.id, messageIds: unique });
  }
  return { archived, undo };
}

export async function unarchiveMessages(userId: string, items: Array<{ accountId: string; messageIds: string[] }>): Promise<{ restored: number }> {
  let restored = 0;
  for (const it of items) {
    const acc = await getOwnedAccount(userId, it.accountId);
    const ids = [...new Set(it.messageIds.map((id) => assertGmailId(id, "message")))];
    await new GmailClient(acc).request("POST", "/messages/batchModify", { body: { ids, addLabelIds: ["INBOX"] } });
    restored += ids.length;
  }
  return { restored };
}
