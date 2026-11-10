import { HttpError } from "../lib/errors.js";
import type { AccountRow } from "../services/accounts.js";
import { GmailProvider } from "./gmail.js";
import { ImapProvider } from "./imap.js";
import type { MailProvider, ProviderCapabilities, ProviderKind } from "./types.js";

export * from "./types.js";

const NONE: ProviderCapabilities = { categories: false, labels: false, filters: false, sendAs: false, importance: false };

export function providerKind(a: Pick<AccountRow, "provider">): ProviderKind {
  return (a.provider ?? "gmail") as ProviderKind;
}

/** The provider behind an (already ownership-checked) account. */
export function providerFor(a: AccountRow): MailProvider {
  const kind = providerKind(a);
  if (kind === "gmail") return new GmailProvider(a);
  if (kind === "imap") return new ImapProvider(a);
  throw new HttpError(501, "provider_unavailable", "This kind of account isn't supported in this version of FLUENT yet.");
}

/** Capabilities without constructing a client (for account listings). */
export function capabilitiesOf(a: Pick<AccountRow, "provider">): ProviderCapabilities {
  return providerKind(a) === "gmail" ? { categories: true, labels: true, filters: true, sendAs: true, importance: true } : NONE;
}

/** Thrown when a Gmail-only feature (filters, send-as, categories, unsubscribe, ...) is used on another provider. */
export function gmailOnlyError(): HttpError {
  return new HttpError(400, "not_supported_for_provider", "This feature is only available for Gmail accounts.");
}
