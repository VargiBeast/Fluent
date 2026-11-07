import { z } from "zod";

export const summarySchema = z
  .object({
    mock: z.boolean(),
    model: z.string().max(80),
    subject: z.string().max(500),
    summary: z.string().max(2000),
    important: z.array(z.string().max(400)).max(8),
    decisions: z.array(z.string().max(400)).max(8),
    questions: z.array(z.string().max(400)).max(8),
    actions: z.array(z.string().max(400)).max(8),
    dates: z.array(z.string().max(80)).max(8),
    uncertainty: z.string().max(400).nullable(),
    untrustedInstructionsIgnored: z.boolean(),
    sourceMessageIds: z.array(z.string().max(200)).max(50),
  })
  .strict();

export const draftSchema = z
  .object({
    mock: z.boolean(),
    model: z.string().max(80),
    body: z.string().max(8000),
    notes: z.array(z.string().max(300)).max(6),
    uncertainty: z.string().max(400).nullable(),
  })
  .strict();

export const overviewSchema = z
  .object({
    mock: z.boolean(),
    model: z.string().max(80),
    overview: z.string().max(2000),
    priorities: z
      .array(z.object({ threadId: z.string().uuid(), reason: z.string().max(300) }).strict())
      .max(8),
    followUps: z
      .array(z.object({ threadId: z.string().uuid(), reason: z.string().max(300) }).strict())
      .max(8),
    uncertainty: z.string().max(400),
    untrustedInstructionsIgnored: z.boolean(),
  })
  .strict();

export const modelSearchSchema = z
  .object({
    understood: z.boolean(),
    gmailQuery: z.string().max(256).nullable(),
    explanation: z.string().max(600),
  })
  .strict();

export type SummaryResult = z.infer<typeof summarySchema>;
export type DraftResult = z.infer<typeof draftSchema>;
export type OverviewResult = z.infer<typeof overviewSchema>;

export const INJECTION_PATTERN =
  /ignore (all |any |previous |prior )?instructions|system prompt|reveal (the )?(secret|token|key|password)|archive all|delete all|trash all|send (the |an )?email|you are now/i;

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 80);
}

export function withoutInjection(sentences: string[]): { kept: string[]; ignored: boolean } {
  const kept = sentences.filter((sentence) => !INJECTION_PATTERN.test(sentence));
  return { kept, ignored: kept.length !== sentences.length };
}
