import { Archive, Clock, File, Inbox, Send, ShieldAlert, Sparkles, Star, Tag, Trash2, type LucideIcon } from "lucide-react";
import type { Folder } from "@shared/mail";

export const FOLDER_META: Record<Folder, { label: string; icon: LucideIcon; countKey?: string }> = {
  inbox: { label: "Inbox", icon: Inbox, countKey: "INBOX" },
  starred: { label: "Starred", icon: Star },
  snoozed: { label: "Snoozed", icon: Clock },
  important: { label: "Important", icon: Tag },
  sent: { label: "Sent", icon: Send },
  drafts: { label: "Drafts", icon: File, countKey: "DRAFT" },
  archive: { label: "Archive", icon: Archive },
  spam: { label: "Spam", icon: ShieldAlert, countKey: "SPAM" },
  trash: { label: "Trash", icon: Trash2 },
  all: { label: "All mail", icon: Inbox },
};

export const OverviewIcon = Sparkles;

export const SIDEBAR_FOLDERS: Folder[] = ["inbox", "starred", "snoozed", "important", "sent", "drafts", "archive", "spam", "trash"];
