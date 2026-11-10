import { z } from "zod";

/** Gmail "send as" identity (Settings → Accounts in Gmail): display name and signature per address. */
export interface SendAsIdentity {
  sendAsEmail: string;
  displayName: string;
  signature: string; // HTML, as stored by Gmail
  isPrimary: boolean;
  isDefault: boolean;
  verified: boolean;
}

export interface SendAsAccount {
  accountId: string;
  email: string;
  identities: SendAsIdentity[];
  error?: { code: string; message: string };
}

export const SENDAS_LIMITS = { displayName: 100, signature: 10_000 } as const;

// eslint-disable-next-line no-control-regex
const singleLine = (s: string) => !/[\u0000-\u001f\u007f]/.test(s);

export const sendAsPatchSchema = z.object({
  displayName: z.string().trim().max(SENDAS_LIMITS.displayName).refine(singleLine, "Invalid characters").refine((s) => !/[<>"]/.test(s), "Names can't contain < > or quotes").optional(),
  signature: z.string().max(SENDAS_LIMITS.signature).optional(),
}).strict().refine((p) => p.displayName !== undefined || p.signature !== undefined, "Nothing to update");

export type SendAsPatch = z.infer<typeof sendAsPatchSchema>;
