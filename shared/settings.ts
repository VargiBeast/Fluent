import { z } from "zod";

export const settingsSchema = z.object({
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]).default("dark"),
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    readingPane: z.enum(["right", "full"]).default("right"),
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
  }).prefault({}),
  privacy: z.object({
    loadRemoteImages: z.enum(["never", "ask", "always"]).default("ask"),
    keepAiHistoryDays: z.number().int().min(0).max(365).default(30),
  }).prefault({}),
  profile: z.object({
    displayName: z.string().max(120).default(""),
  }).prefault({}),
});

export type Settings = z.infer<typeof settingsSchema>;

/** Partial update payload. No defaults here, so omitted fields are left untouched. */
export const settingsPatchSchema = z.object({
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]),
    density: z.enum(["comfortable", "compact"]),
    readingPane: z.enum(["right", "full"]),
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
  }).partial().strict().optional(),
  privacy: z.object({
    loadRemoteImages: z.enum(["never", "ask", "always"]),
    keepAiHistoryDays: z.number().int().min(0).max(365),
  }).partial().strict().optional(),
  profile: z.object({ displayName: z.string().max(120) }).partial().strict().optional(),
  onboarded: z.boolean().optional(),
}).strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export function parseSettings(raw: unknown): Settings {
  const r = settingsSchema.safeParse(raw ?? {});
  return r.success ? r.data : settingsSchema.parse({});
}
