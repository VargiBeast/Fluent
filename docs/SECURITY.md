# Security model

MailIQ is designed so that email content never touches the database, OAuth tokens are encrypted at rest, and every AI action is logged and under the user's control.

## Threat model (summary)

| Threat | Mitigation |
| --- | --- |
| Stolen database | Tokens AES-256-GCM (HKDF, AAD-bound); session ids hashed; email bodies never stored |
| Stolen session cookie | HttpOnly, `__Host-`/Secure on HTTPS, SameSite=Lax; CSRF token on mutations |
| Cross-user data access | Every account/thread id checked against the authenticated user; RLS lockdown on Supabase |
| Prompt injection / AI abuse | Email content delimited as untrusted; no tools for the model; exclusions enforced server-side before any AI call; confirmation required before send |
| XSS from email HTML | DOMPurify + sandboxed iframe with its own CSP; remote images blocked by default |
| SSRF (unsubscribe, IMAP) | Outbound requests pinned to validated public IPs; private/loopback/link-local blocked |
| Token leakage in logs | Structured logging (pino) never includes email content, subjects, prompts or tokens |

Full details of controls, Google OAuth verification / CASA, and data handling are in the sections below.

## Google OAuth verification and CASA

`gmail.modify` and `gmail.settings.basic` are restricted scopes. Until Google completes OAuth app verification **and** an annual CASA security assessment, MailIQ can only be used by test users listed on the consent screen. See SETUP for the registration steps.

## Data MailIQ stores

- Users, accounts (encrypted OAuth tokens / IMAP credentials), sessions (hashed ids), settings
- AI audit log (feature, subject ids, timestamps — never bodies)
- Security events, rate limits, daily briefs (encrypted payload), snoozes, templates, read-later, thread notes (encrypted)

Email bodies and attachments are fetched live from Gmail/Graph/IMAP and are never written to the database.

## Encryption

OAuth tokens and other sensitive fields use AES-256-GCM with HKDF-derived sub-keys and AAD bound to the row. Session identifiers are hashed before storage. Cookies are httpOnly; on HTTPS they use the `__Host-` prefix.

## AI

The model has no tools. Content is delimited. Exclusions (senders/domains/labels) are enforced on the server before any AI call. Every AI feature writes an audit row. Users can clear history, export data (without tokens), or delete their account (tokens revoked).

## Reporting

Security issues: open a private GitHub security advisory or contact the operator listed in `/privacy`.
