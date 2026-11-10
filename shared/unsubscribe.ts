import { z } from "zod";

/** Unsubscribe assistant: newsletter senders found via the List-Unsubscribe header. Nothing is stored server-side. */
export const UNSUB_RANGES = [30, 90, 180] as const;
export type UnsubRange = (typeof UNSUB_RANGES)[number];
export const UNSUB_LIMITS = { messagesPerAccount: 500, sendersPerArchive: 50, messagesPerSender: 1000 } as const;

const uuid = z.string().uuid();
const gmailId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
// A plain address only: no spaces, quotes, parentheses or braces, so it can't change the Gmail query it's used in.
const senderEmail = z.string().trim().toLowerCase().max(254).email().regex(/^[^\s"'(){}<>\\]+$/);

export const unsubScanSchema = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(30), z.literal(90), z.literal(180)])).default(90),
  account: z.union([z.literal("all"), uuid]).optional(),
}).strict();

/** One-click (RFC 8058) or mailto unsubscribe for the newsletter in this message. `confirm` must be sent by the UI's explicit click. */
export const unsubActionSchema = z.object({
  accountId: uuid,
  messageId: gmailId,
  method: z.enum(["one-click", "mailto"]),
  confirm: z.literal(true),
}).strict();

export const unsubArchiveSchema = z.object({
  senders: z.array(z.object({ accountId: uuid, email: senderEmail }).strict()).min(1).max(UNSUB_LIMITS.sendersPerArchive),
  confirm: z.literal(true),
}).strict();

export const unsubUndoArchiveSchema = z.object({
  items: z.array(z.object({ accountId: uuid, messageIds: z.array(gmailId).min(1).max(UNSUB_LIMITS.messagesPerSender) }).strict()).min(1).max(UNSUB_LIMITS.sendersPerArchive),
}).strict();

export interface UnsubMethods {
  /** RFC 8058 one-click: FLUENT sends the POST for you. */
  oneClick: boolean;
  /** Sends an email from your account; shown in a confirm dialog first. */
  mailto: { address: string; subject: string } | null;
  /** An https page to open yourself (no one-click support). */
  link: string | null;
}

export interface NewsletterSender {
  accountId: string;
  email: string;
  name: string;
  /** Newsletter messages from this sender in the scanned window. */
  total: number;
  read: number;
  unread: number;
  /** read / total (0–1): how often you actually open them. */
  openRate: number;
  /** How many of them are still in the Inbox (what "Archive all" would move). */
  inInbox: number;
  lastAt: string;
  /** The latest message with an unsubscribe header (actions re-read the header from Gmail). */
  messageId: string;
  methods: UnsubMethods;
}

export interface NewsletterScan {
  generatedAt: string;
  days: UnsubRange;
  senders: NewsletterSender[];
  sample: { messages: number; limit: number; truncated: boolean };
  errors: Array<{ accountId: string; code: string; message: string }>;
}

export interface UnsubActionResult { ok: true; method: "one-click" | "mailto"; sender: string }
export interface ArchiveResult { archived: number; undo: Array<{ accountId: string; messageIds: string[] }> }

/** Least-opened first, then the noisiest. */
export function compareSenders(a: Pick<NewsletterSender, "openRate" | "total" | "lastAt">, b: Pick<NewsletterSender, "openRate" | "total" | "lastAt">): number {
  return a.openRate - b.openRate || b.total - a.total || b.lastAt.localeCompare(a.lastAt);
}
