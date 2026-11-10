import type { Category, DraftSummary, Folder, GmailLabel, MessageDetail, ThreadAction, ThreadDetail, ThreadSummary } from "../../shared/mail.js";
import type { MimeAttachment } from "../gmail/mime.js";
import type { AccountRow } from "../services/accounts.js";

export const PROVIDER_KINDS = ["gmail", "imap", "outlook"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** What a provider can do beyond the core mailbox operations. The UI hides what's missing. */
export interface ProviderCapabilities {
  /** Gmail inbox categories (Primary, Promotions, ...). */
  categories: boolean;
  /** User labels that can be created, renamed and applied (Gmail labels, or folders elsewhere). */
  labels: boolean;
  /** Server-side filters managed from FLUENT. */
  filters: boolean;
  /** Send-as display name managed from FLUENT. */
  sendAs: boolean;
  /** An "important" marker. */
  importance: boolean;
}

export interface ListOptions {
  folder: Exclude<Folder, "later">;
  category?: Category;
  label?: string;
  q?: string;
  pageToken?: string;
  limit: number;
}

export interface LabelsInfo {
  labels: GmailLabel[];
  /** Unread counts keyed by system folder id (INBOX, SPAM, ...; DRAFT is a total). */
  counts: Record<string, number>;
}

/** A fully-built outgoing message: the RFC 5322 bytes plus the thread it belongs to. */
export interface OutgoingMessage {
  mime: string;
  threadId?: string;
}

export interface SavedDraft { draftId: string; messageId: string; threadId: string }

/** Raw draft contents for reopening in the composer. */
export interface DraftContents {
  draftId: string;
  message: MessageDetail;
  inReplyTo: string | null;
  references: string | null;
}

export interface SyncResult { changed: boolean; newInbox: number }

/**
 * One connected mailbox. Every method is scoped to the account it was created for; callers must have
 * ownership-checked that account (services/accounts.getOwnedAccount) first. Implementations never log bodies.
 */
export interface MailProvider {
  readonly kind: ProviderKind;
  readonly account: AccountRow;
  readonly capabilities: ProviderCapabilities;
  listThreads(o: ListOptions): Promise<{ threads: ThreadSummary[]; nextPageToken: string | null }>;
  getThread(threadId: string): Promise<ThreadDetail>;
  threadAction(threadId: string, action: ThreadAction): Promise<void>;
  /** Apply one action (or a label add/remove) to many threads; returns how many succeeded. */
  bulk(threadIds: string[], action: BulkActionSpec): Promise<{ ok: number; failed: number }>;
  modifyLabels(threadId: string, add: string[], remove: string[]): Promise<void>;
  labels(): Promise<LabelsInfo>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  /** Display name for the From line. */
  senderName(): Promise<string | undefined>;
  send(m: OutgoingMessage, draftId?: string): Promise<{ id: string; threadId: string }>;
  saveDraft(m: OutgoingMessage, draftId?: string): Promise<SavedDraft>;
  getDraft(draftId: string): Promise<DraftContents>;
  deleteDraft(draftId: string): Promise<void>;
  listDrafts(): Promise<DraftSummary[]>;
  /** Cheap change detection since the last call (state kept on the account row). */
  sync(): Promise<SyncResult>;
}

export type BulkActionSpec =
  | { kind: "action"; action: ThreadAction }
  | { kind: "label"; labelId: string; add: boolean };

export type { MimeAttachment };
