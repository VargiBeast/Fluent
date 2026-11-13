import { z } from "zod";
import { FOCUS_CHOICES, focusUntilSchema } from "./focus.js";

/** Accent colours. Purple is MailIQ's brand default; each one has light and dark tokens in index.css. */
export const ACCENTS = ["purple", "blue", "teal", "rose", "orange"] as const;
export type Accent = (typeof ACCENTS)[number];

/** "auto" (follow the browser) or a BCP 47 tag the runtime understands, e.g. "nb-NO". */
const localeSchema = z.string().trim().max(35).refine((v) => {
  if (v === "auto") return true;
  try { return Intl.getCanonicalLocales(v).length === 1; } catch { return false; }
}, "Unknown language");
/** "auto" (follow the device) or an IANA time zone, e.g. "Europe/Oslo". */
const timeZoneSchema = z.string().trim().max(64).refine((v) => {
  if (v === "auto") return true;
  try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
}, "Unknown time zone");
export const DEFAULT_VIEWS = ["inbox", "overview", "starred", "important"] as const;

export const settingsSchema = z.object({
  general: z.object({
    language: localeSchema.catch("auto").default("auto"),
    timeZone: timeZoneSchema.catch("auto").default("auto"),
    defaultView: z.enum(DEFAULT_VIEWS).catch("inbox").default("inbox"),
  }).prefault({}),
  shortcuts: z.object({ enabled: z.boolean().default(true) }).prefault({}),
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]).default("dark"),
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    readingPane: z.enum(["right", "full"]).default("right"),
    accent: z.enum(ACCENTS).catch("purple").default("purple"),
  }).prefault({}),
  notifications: z.object({
    desktop: z.boolean().default(false),
    inApp: z.boolean().default(true),
    importantOnly: z.boolean().default(false),
  }).prefault({}),
  ai: z.object({
    enabled: z.boolean().default(true),
    tone: z.enum(["professional", "friendly", "concise", "warm"]).default("professional"),
    language: z.string().max(40).default("auto"),
    signature: z.string().max(500).default(""),
    autoSummarize: z.boolean().default(true),
    excludedLabels: z.array(z.string().max(120)).max(100).default([]),
    excludedSenders: z.array(z.string().max(254)).max(200).default([]),
    dailyBrief: z.boolean().default(true),
    /** Hour of the day (0–23, your time zone) from which the inbox shows that day's brief. */
    briefHour: z.number().int().min(0).max(23).catch(0).default(0),
  }).prefault({}),
  privacy: z.object({
    loadRemoteImages: z.enum(["never", "ask", "always"]).default("ask"),
    keepAiHistoryDays: z.number().int().min(0).max(365).default(30),
  }).prefault({}),
  profile: z.object({
    displayName: z.string().max(120).default(""),
  }).prefault({}),
  compose: z.object({
    /** Seconds MailIQ waits before actually sending, so you can undo. */
    undoSendSeconds: z.enum(["0", "5", "10", "20"]).default("5"),
  }).prefault({}),
  /** Focus mode: while `until` is in the future the inbox shows only important mail. */
  focus: z.object({
    until: z.string().datetime({ offset: true }).nullable().catch(null).default(null),
    defaultChoice: z.enum(FOCUS_CHOICES).catch("30m").default("30m"),
    /** Silence new-mail toasts while focus mode is on. */
    muteToasts: z.boolean().default(true),
  }).prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Partial update payload. No defaults here, so omitted fields are left untouched. */
export const settingsPatchSchema = z.object({
  general: z.object({ language: localeSchema, timeZone: timeZoneSchema, defaultView: z.enum(DEFAULT_VIEWS) }).partial().strict().optional(),
  shortcuts: z.object({ enabled: z.boolean() }).partial().strict().optional(),
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]),
    density: z.enum(["comfortable", "compact"]),
    readingPane: z.enum(["right", "full"]),
    accent: z.enum(ACCENTS),
  }).partial().strict().optional(),
  notifications: z.object({ desktop: z.boolean(), inApp: z.boolean(), importantOnly: z.boolean() }).partial().strict().optional(),
  ai: z.object({
    enabled: z.boolean(),
    tone: z.enum(["professional", "friendly", "concise", "warm"]),
    language: z.string().max(40),
    signature: z.string().max(500),
    autoSummarize: z.boolean(),
    excludedLabels: z.array(z.string().trim().min(1).max(120)).max(100),
    excludedSenders: z.array(z.string().trim().toLowerCase().min(1).max(254)).max(200),
    dailyBrief: z.boolean(),
    briefHour: z.number().int().min(0).max(23),
  }).partial().strict().optional(),
  privacy: z.object({
    loadRemoteImages: z.enum(["never", "ask", "always"]),
    keepAiHistoryDays: z.number().int().min(0).max(365),
  }).partial().strict().optional(),
  profile: z.object({ displayName: z.string().max(120) }).partial().strict().optional(),
  compose: z.object({ undoSendSeconds: z.enum(["0", "5", "10", "20"]) }).partial().strict().optional(),
  focus: z.object({ until: focusUntilSchema, defaultChoice: z.enum(FOCUS_CHOICES), muteToasts: z.boolean() }).partial().strict().refine((o) => Object.keys(o).length > 0, "Nothing to change").optional(),
  onboarded: z.boolean().optional(),
}).strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function parseSettings(raw: unknown): Settings {
  const r = settingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : settingsSchema.parse({});
}

/** Typed confirmation for deleting a MailIQ account. */
export const DELETE_ACCOUNT_PHRASE = "Delete my account";
