import type { ThreadSummary } from "./mail.js";

export interface BriefItem {
  thread: ThreadSummary;
  reason: string;
}

/** Copilot's morning summary, generated the first time the user opens FLUENT each (local) day. */
export interface DailyBrief {
  day: string;
  generatedAt: string;
  cached: boolean;
  headline: string | null;
  important: BriefItem[];
  awaitingReply: BriefItem[];
  safeToArchive: BriefItem[];
  aiStatus: "ok" | "not_configured" | "disabled" | "error";
  excluded: number;
}
