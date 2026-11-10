import { z } from "zod";

export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export const statsQuerySchema = z.object({
  days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(30),
  account: z.union([z.literal("all"), z.string().uuid()]).optional(),
  tz: z.string().max(64).regex(/^[A-Za-z0-9_+\-/]+$/).optional(),
}).strict();

export interface VolumeBucket { start: string; received: number; sent: number }
export interface TopSender { email: string; name: string; count: number }
export interface ResponseBucket { id: "lt1h" | "1to4h" | "4to24h" | "1to3d" | "gt3d"; label: string; count: number }

export interface InboxStats {
  generatedAt: string;
  days: StatsRange;
  timeZone: string;
  granularity: "day" | "week";
  totals: { received: number; sent: number; conversations: number };
  volume: VolumeBucket[];
  topSenders: TopSender[];
  response: { averageMinutes: number | null; medianMinutes: number | null; replies: number; buckets: ResponseBucket[] };
  /** Received mail by hour of day (0–23) in the user's time zone. */
  byHour: number[];
  /** How much of the mailbox was read: stats are computed from the most recent conversations only. */
  sample: { conversations: number; limit: number; truncated: boolean };
  errors: Array<{ accountId: string; code: string; message: string }>;
}
