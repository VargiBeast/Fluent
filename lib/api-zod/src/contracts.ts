import { z } from "zod";

export const approvalBodySchema = z
  .object({
    threadId: z.string().uuid(),
    action: z.enum(["archive", "trash"]),
  })
  .strict();

export const consumeApprovalSchema = z
  .object({
    approvalId: z.string().uuid(),
  })
  .strict();

export const searchBodySchema = z
  .object({
    query: z.string().trim().min(1).max(400),
    pageToken: z.string().max(512).optional(),
  })
  .strict();

export const draftBodySchema = z
  .object({
    threadId: z.string().uuid().nullable().optional(),
    kind: z.enum(["reply", "compose"]),
    toEmail: z.string().max(320).optional(),
    subject: z.string().max(500).optional(),
    body: z.string().max(20000),
  })
  .strict();

export const draftUpdateSchema = draftBodySchema.partial().extend({
  body: z.string().max(20000).optional(),
});

export const aiDraftBodySchema = z
  .object({
    threadId: z.string().uuid(),
    instruction: z.string().trim().min(1).max(500),
    draft: z.string().max(20000).optional(),
  })
  .strict();

export const preferencesSchema = z
  .object({
    loadRemoteImages: z.boolean().optional(),
    onboarded: z.boolean().optional(),
    timezone: z.string().min(1).max(80).optional(),
  })
  .strict();

export const labelBodySchema = z
  .object({
    starred: z.boolean().optional(),
    unread: z.boolean().optional(),
  })
  .strict();
