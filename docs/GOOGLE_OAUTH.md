# Google OAuth

Create a Google Cloud OAuth client for FLUENT only.

Authorized redirect URIs, using the real `APP_ORIGIN`:

- `{APP_ORIGIN}/api/auth/google/callback`
- `{APP_ORIGIN}/api/gmail/connect/callback`

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `TOKEN_ENCRYPTION_KEY` on the API. Leave them unset and the UI shows a blocked setup state. It does not pretend the connection succeeded.

## Scopes

Sign-in: `openid`, `email`, `profile`.

The login access token is used once for userinfo and is not stored.

Mailbox connect, incremental and separate: `openid`, `email`, and `https://www.googleapis.com/auth/gmail.modify`.

Google's scope description: "Read, compose, and send emails from your Gmail account." The scope does not allow immediate permanent deletion. Permanent deletion requires `https://mail.google.com/`, which FLUENT does not request.

FLUENT calls list, get, modify labels, and trash. It does not call send, draft create/update/send, or delete. The allowlist is in `artifacts/api-server/src/gmail/guard.ts`. Replies are rows in `local_drafts`.

Gmail's verification review for a restricted scope is a manual Google process. Until the client exists, connection stays blocked.

## Token lifecycle

- State and PKCE verifier are single-use, expire in 10 minutes, and must match the `fluent_oauth` cookie.
- Refresh tokens are stored as AES-256-GCM ciphertext.
- Access tokens refresh about a minute before expiry.
- A failed refresh marks the account `reauth_required`.
- Disconnect calls Google's revoke endpoint and always clears the ciphertext.
