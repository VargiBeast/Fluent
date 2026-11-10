import { z } from "zod";

/** Private notes pinned to a conversation. Only the user who wrote them can see them; never sent to Gmail. */
export const NOTE_LIMITS = { body: 5000, maxPerUser: 2000 } as const;

// eslint-disable-next-line no-control-regex
const noControl = (s: string) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s);

export const noteInputSchema = z.object({
  body: z.string().max(NOTE_LIMITS.body, `Notes can be up to ${NOTE_LIMITS.body} characters`)
    .refine((s) => s.trim().length > 0, "The note is empty").refine(noControl, "Invalid characters"),
}).strict();

export type NoteInput = z.infer<typeof noteInputSchema>;

export interface ThreadNote {
  accountId: string;
  threadId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
