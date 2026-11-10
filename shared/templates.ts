import { z } from "zod";

/** Saved replies ("templates"/"snippets"). Written by the user, stored encrypted per user. */
export const TEMPLATE_LIMITS = { maxPerUser: 100, name: 80, subject: 200, body: 10_000 } as const;

// eslint-disable-next-line no-control-regex
const noControl = (s: string) => !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(s);
// eslint-disable-next-line no-control-regex
const singleLine = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);

export const templateInputSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(TEMPLATE_LIMITS.name).refine(singleLine, "Invalid characters"),
  subject: z.string().trim().max(TEMPLATE_LIMITS.subject).refine(singleLine, "Invalid characters").default(""),
  body: z.string().max(TEMPLATE_LIMITS.body).refine((s) => s.trim().length > 0, "The template is empty").refine(noControl, "Invalid characters"),
}).strict();

export type TemplateInput = z.infer<typeof templateInputSchema>;

export interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
