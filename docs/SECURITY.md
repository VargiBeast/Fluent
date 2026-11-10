# Security and privacy

This document describes FLUENT's security model and what is still required before public launch.

## Data minimisation

- **No email content at rest.** Messages, bodies, snippets and attachments are fetched live from the Gmail API for each request and never written to the database. Drafts live in Gmail.
- **Stored per user:** Google profile (id, email, name, picture URL), connected accounts (email, granted scopes, status, encrypted tokens), settings, sessions (hashed id, user-agent, timestamps), an AI access log (feature, thread ids, encrypted subjects, counts), a security log (event type, small non-content detail) and rate-limit counters. See `server/db/schema.ts`.
- **Logs** (pino, JSON) record request metadata and error codes. Bodies, subjects, snippets, prompts, cookies and tokens are never passed to the logger, and pino redaction removes those keys as a second safeguard.

## Authentication

- Google OAuth 2.0 **authorization-code flow on the server** with **PKCE (S256)**, a random `state` and an OIDC `nonce`. The state, verifier and nonce live in a short-lived, AES-GCM-sealed, httpOnly cookie scoped to `/api/auth`. The callback rejects missing, forged or expired state, and checks that the ID token's signature (Google JWKS), issuer, audience, nonce and `email_verified` are valid.
- `access_type=offline` plus `prompt=consent` produces refresh tokens. Granted scopes are checked: if the user unticks the Gmail permission, the account is marked `insufficient_scopes` and the UI asks them to grant it.
- Sessions use a random 256-bit token in an httpOnly, `SameSite=Lax` cookie (`__Host-` prefixed and `Secure` on HTTPS). Only the SHA-256 hash of the token is stored. Sessions expire after `SESSION_TTL_DAYS` (default 30), and can be revoked individually or all at once from Settings → Security.
- Login redirects only accept same-origin relative `next` paths (no open redirects).

## CSRF

All non-GET requests must (1) carry an `Origin` (or `Referer`) equal to `APP_URL` and (2) send the per-session synchronizer token in `X-CSRF-Token`, compared in constant time. Combined with SameSite=Lax cookies this blocks cross-site form posts and fetches.

## Encryption

OAuth access and refresh tokens, the OAuth state cookie and AI-audit subjects are encrypted with **AES-256-GCM**. Each purpose uses its own sub-key, derived from `TOKEN_ENCRYPTION_KEY` with HKDF-SHA256, and its ciphertext is bound to its owner by additional authenticated data (for tokens: `userId:googleSub`). Database connections to hosted Postgres use TLS.

## Authorisation and isolation

Every query is scoped by the session's `user_id`. Account ids from the client are always resolved with `getOwnedAccount(userId, accountId)`, which returns 404 for accounts owned by someone else. Gmail ids are validated against a strict character set before being placed in API paths. Integration tests cover cross-user access to threads, actions, attachments, drafts, sending, accounts and privacy data. On Supabase, migration `0001_lockdown.sql` enables RLS on all tables with no policies and revokes privileges from the `anon` and `authenticated` roles, so the Supabase Data API cannot read FLUENT's tables.

## Input validation and rate limiting

All request bodies and queries are validated with zod (`.strict()` objects, length limits). Outgoing headers are checked for CR/LF injection, and recipients are normalised. Fixed-window rate limits, stored in Postgres so they hold across serverless instances, protect auth (30/min), mail (240/min), send (20/min), drafts (60/min), AI (30/min), settings (120/min) and privacy (60/min).

## Rendering untrusted email

1. HTML is sanitised with DOMPurify. Scripts, frames, forms, SVG/MathML, `srcset`/`ping`, event handlers, `javascript:`/`data:` and root-relative links are removed, as is `position:fixed`.
2. **Remote images are blocked by default** (`<img>`, CSS `url()`, `@import`) to defeat tracking pixels. The user can allow them per message or change the default in Settings. Inline `cid:` images are resolved from the message's own attachments.
3. The result is rendered in an `<iframe sandbox>` **without `allow-scripts`** (only `allow-same-origin` for height measurement plus `allow-popups` so links open in a new tab) with its own CSP: `default-src 'none'`, plus images limited to `data:` (and `https:` only when allowed).
4. The app itself is served with a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`).

## AI safety

- **The model has no tools.** AI endpoints only return text (summaries, drafts, Gmail queries, answers). No code path lets model output send, delete, archive, forward or label mail. Every such action requires a user click.
- AI-written text is clearly marked. Before sending it, the UI requires an explicit confirmation dialog. The send API also refuses messages flagged `aiGenerated` without `aiConfirmed` (`409 ai_confirmation_required`). That check depends on the client's flag, so the real guarantee is the absence of any AI-to-send path.
- **Prompt-injection defences.** Email content goes into the prompt only inside `<email …>` blocks. Delimiter-like strings in email content are neutralised, and a non-overridable system preamble tells the model to treat that content as untrusted data and to flag manipulation attempts. Structured outputs are validated with zod. Gmail queries returned by the model are checked for newlines. "Ask your inbox" citations are mapped only onto emails actually supplied, and made-up references are dropped.
- **Exclusions** (senders, domains, labels) are enforced on the server before any provider call: thread features return `403 ai_excluded`, and list features (overview, ask, search results) drop excluded threads. Turning AI off returns `403 ai_disabled` everywhere.
- Requests to xAI and OpenAI set `store: false`. The Gemini API has no such flag: Google keeps paid-tier prompts and responses for a limited time only to detect abuse. **On Gemini's free tier, Google may use prompts and responses to improve its products, and human reviewers may read them.** Use a paid (billing-enabled) key before real users' email goes through FLUENT, and keep the free tier for development with test mailboxes. The **AI access log** records feature, time, thread ids and encrypted subjects only, honours the user's retention setting (0 = off) and can be cleared.

## User controls

Settings → Privacy (exclusions, remote images, AI history retention, access log, clear history) and Settings → Your data (list of stored data, JSON export without tokens, delete everything). Deleting revokes each Google token at `oauth2.googleapis.com/revoke` and cascades all rows.

## Google OAuth verification and CASA

`gmail.modify` and `gmail.settings.basic` are **restricted** Gmail scopes. Before FLUENT can be used by anyone outside the OAuth consent screen's test-user list, the owner must:

1. Complete **Google OAuth app verification**: verified domain, homepage, privacy policy and terms URLs (the in-app `/privacy` and `/terms` pages, with the owner's name and contact filled in; they currently contain visible placeholders), a demo video and scope justifications.
2. Pass the annual **CASA (Cloud Application Security Assessment)** by a Google-approved assessor, as required for restricted scopes. This is a paid, external process and has not been done.
3. Keep complying with the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including Limited Use. The privacy policy contains the required disclosure.

Until then, keep the app in **Testing** with named test users.

## Known limitations

- Permanent deletion is not offered; "Delete" moves mail to Gmail's Trash (it needs the broader `mail.google.com` scope).
- Gmail push notifications (Pub/Sub) are not used. The app polls `history.list` about every 45 s while open.
- Rate limits are per user and route, not per IP, for authenticated routes. Anonymous auth routes are limited per IP header as forwarded by Vercel.
- The AI provider's own data handling is governed by its API terms. FLUENT only controls what it sends. With the default Gemini provider this depends on the key's tier (see the AI safety section above).

## Reporting

Security contact: to be added by the owner (see the placeholders in `web/src/pages/Legal.tsx`).
