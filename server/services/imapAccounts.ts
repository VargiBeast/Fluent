import { getDb } from "../db/client.js";
import { accounts } from "../db/schema.js";
import { HttpError } from "../lib/errors.js";
import type { ImapAccountInput } from "../../shared/imap.js";
import { sealCredentials, smtpSend, withImap, type ImapCredentials } from "../providers/imap.js";
import { listAccounts, logSecurityEvent, type AccountRow } from "./accounts.js";

export const MAX_ACCOUNTS = 10;

/**
 * Connect an IMAP/SMTP mailbox: check both logins against the (SSRF-checked, pinned) servers first, then store the
 * connection details with the app password AES-GCM encrypted. The password is never logged or returned.
 */
export async function addImapAccount(userId: string, input: ImapAccountInput): Promise<AccountRow> {
  const creds: ImapCredentials = { username: input.username || input.email, password: input.password, imap: input.imap, smtp: input.smtp };
  const sub = `imap:${creds.username.toLowerCase()}@${creds.imap.host}`;
  const existing = await listAccounts(userId);
  if (!existing.some((a) => a.googleSub === sub) && existing.length >= MAX_ACCOUNTS) {
    throw new HttpError(400, "too_many_accounts", `You can connect up to ${MAX_ACCOUNTS} accounts.`);
  }
  await withImap(creds, async (c) => { await c.status("INBOX", { messages: true }); }, input.email);
  await smtpSend(creds, { from: input.email, to: [] }, null);
  const values = {
    provider: "imap",
    email: input.email,
    name: input.name,
    scopes: "",
    credentialsEnc: sealCredentials({ userId, googleSub: sub }, creds),
    refreshTokenEnc: null,
    accessTokenEnc: null,
    accessTokenExpiresAt: null,
    historyId: null,
    status: "active",
    updatedAt: new Date(),
  };
  const [row] = await getDb().insert(accounts).values({ userId, googleSub: sub, ...values })
    .onConflictDoUpdate({ target: [accounts.userId, accounts.googleSub], set: values }).returning();
  await logSecurityEvent(userId, "account_connected", `imap:${input.email}`);
  return row!;
}

