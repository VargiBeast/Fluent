export interface Address {
  name: string;
  email: string;
}

export interface ThreadSummary {
  id: string;
  accountId: string;
  subject: string;
  snippet: string;
  participants: Address[];
  from: Address;
  /** Recipients of the latest message (used to show who you're waiting on). */
  to: Address[];
  lastDate: string;
  messageCount: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  hasAttachments: boolean;
  labelIds: string[];
  lastFromMe: boolean;
}

export interface AttachmentMeta {
  attachmentId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId: string | null;
  inline: boolean;
}

export interface MessageDetail {
  id: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: string;
  subject: string;
  messageIdHeader: string;
  references: string;
  snippet: string;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: AttachmentMeta[];
  labelIds: string[];
  unread: boolean;
  isFromMe: boolean;
  isDraft: boolean;
}

export interface ThreadDetail {
  id: string;
  accountId: string;
  accountEmail: string;
  subject: string;
  labelIds: string[];
  starred: boolean;
  important: boolean;
  unread: boolean;
  inTrash: boolean;
  inInbox: boolean;
  messages: MessageDetail[];
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextCursor: string | null;
  errors: Array<{ accountId: string; code: string; message: string }>;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
  color: { backgroundColor: string; textColor: string } | null;
}

export interface LabelsResponse {
  accounts: Array<{ accountId: string; labels: GmailLabel[]; counts: Record<string, number> }>;
}

export const FOLDERS = ["inbox", "starred", "snoozed", "important", "sent", "drafts", "archive", "spam", "trash", "all"] as const;
export type Folder = (typeof FOLDERS)[number];

export const CATEGORIES = ["primary", "promotions", "social", "updates", "forums"] as const;
export type Category = (typeof CATEGORIES)[number];

export const THREAD_ACTIONS = ["star", "unstar", "read", "unread", "archive", "inbox", "important", "unimportant", "trash", "untrash", "spam", "notspam"] as const;
export type ThreadAction = (typeof THREAD_ACTIONS)[number];

export interface DraftSummary {
  draftId: string;
  messageId: string;
  threadId: string;
  accountId: string;
  to: Address[];
  subject: string;
  snippet: string;
  date: string;
}
