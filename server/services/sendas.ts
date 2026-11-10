import { GmailClient } from "../gmail/client.js";
import { cleanOutgoingHtml } from "../gmail/mime.js";
import { HttpError, notFound } from "../lib/errors.js";
import { logger } from "../logger.js";
import type { SendAsAccount, SendAsIdentity, SendAsPatch } from "../../shared/sendas.js";
import { getOwnedAccount, listAccounts, type AccountRow } from "./accounts.js";

interface GmailSendAs {
  sendAsEmail: string;
  displayName?: string;
  signature?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  verificationStatus?: string;
}

const toIdentity = (s: GmailSendAs): SendAsIdentity => ({
  sendAsEmail: s.sendAsEmail,
  displayName: s.displayName ?? "",
  signature: s.signature ?? "",
  isPrimary: Boolean(s.isPrimary),
  isDefault: Boolean(s.isDefault),
  // Primary addresses have no verification status; aliases must be "accepted" to be usable.
  verified: Boolean(s.isPrimary) || s.verificationStatus === "accepted",
});

async function fetchSendAs(gm: GmailClient): Promise<SendAsIdentity[]> {
  const r = await gm.request<{ sendAs?: GmailSendAs[] }>("GET", "/settings/sendAs");
  return (r.sendAs ?? []).map(toIdentity).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sendAsEmail.localeCompare(b.sendAsEmail));
}

/** All send-as identities for each of the user's accounts. One account failing doesn't hide the others. */
export async function listSendAs(userId: string): Promise<SendAsAccount[]> {
  const accs = await listAccounts(userId);
  return Promise.all(accs.map(async (a): Promise<SendAsAccount> => {
    try {
      return { accountId: a.id, email: a.email, identities: await fetchSendAs(new GmailClient(a)) };
    } catch (err) {
      return { accountId: a.id, email: a.email, identities: [], error: { code: err instanceof HttpError ? err.code : "error", message: err instanceof HttpError ? err.message : "Could not load Gmail settings for this account." } };
    }
  }));
}

/**
 * Update the display name and/or signature of one send-as address. The address must be one Gmail lists for
 * this (owned) account, so the client can't point the request at anything else.
 */
export async function updateSendAs(userId: string, accountId: string, sendAsEmail: string, patch: SendAsPatch): Promise<SendAsIdentity> {
  const acc = await getOwnedAccount(userId, accountId);
  const gm = new GmailClient(acc);
  const target = (await fetchSendAs(gm)).find((s) => s.sendAsEmail.toLowerCase() === sendAsEmail.toLowerCase());
  if (!target) throw notFound("That address isn't a send-as address of this account.");
  const body: Record<string, string> = {};
  if (patch.displayName !== undefined) body.displayName = patch.displayName;
  if (patch.signature !== undefined) body.signature = cleanOutgoingHtml(patch.signature);
  const r = await gm.request<GmailSendAs>("PATCH", `/settings/sendAs/${encodeURIComponent(target.sendAsEmail)}`, { body });
  return toIdentity(r);
}

/**
 * The name FLUENT puts in From: Gmail's send-as display name for the account's own address, so a change in
 * Settings → Signatures (or in Gmail) applies to mail sent from FLUENT. Falls back to the Google profile name.
 */
export async function senderDisplayName(gm: GmailClient): Promise<string | undefined> {
  const acc: AccountRow = gm.account;
  try {
    const s = await gm.request<GmailSendAs>("GET", `/settings/sendAs/${encodeURIComponent(acc.email)}`);
    return s.displayName?.trim() || acc.name || undefined;
  } catch (err) {
    logger.warn({ code: err instanceof HttpError ? err.code : "error" }, "sendas_name_lookup_failed");
    return acc.name || undefined;
  }
}
