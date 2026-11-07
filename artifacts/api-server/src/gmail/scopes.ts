/**
 * Sign-in is intentionally separate from mailbox access.
 * openid/email/profile identify the FLUENT user. They do not read Gmail.
 */
export const LOGIN_SCOPES = ["openid", "email", "profile"] as const;

/**
 * Google describes gmail.modify as: "Read, compose, and send emails from your
 * Gmail account." It also covers label changes and moving mail to Trash.
 * It does not allow immediate permanent deletion. That requires
 * https://mail.google.com/, which FLUENT does not request.
 *
 * The scope is broader than archive/trash. FLUENT still has no send endpoint,
 * no Gmail draft writes, and no messages.delete call. Reply text stays in
 * local_drafts.
 */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export const GMAIL_CONNECT_SCOPES = ["openid", "email", GMAIL_MODIFY_SCOPE] as const;

export const GMAIL_SCOPE_FACTS = {
  scope: GMAIL_MODIFY_SCOPE,
  officialSummary:
    "Read, compose, and send emails from your Gmail account. Does not allow immediate, permanent deletion of threads and messages, bypassing Trash.",
  includesSend: true,
  includesPermanentDelete: false,
  fluentCalls: [
    "users.threads.list",
    "users.threads.get",
    "users.threads.modify",
    "users.threads.trash",
    "users.messages.modify",
    "oauth2.revoke",
    "oauth2.userinfo",
  ],
  fluentRefuses: [
    "users.messages.send",
    "users.drafts.create",
    "users.drafts.update",
    "users.drafts.send",
    "users.messages.delete",
    "users.threads.delete",
  ],
} as const;
