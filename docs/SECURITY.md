# Security and privacy

This document describes FLUENT's security model and what is still required before public launch.

## Data minimisation

- **No email content at rest.** Messages, bodies, snippets and attachments are fetched live from the Gmail API for each request and never written to the database. Drafts live in Gmail. The one exception is a pending Copilot plan (subjects, sender names and AI-written draft text, never email bodies). It is encrypted, usable for 10 minutes, and wiped on confirm or cancel.
- **Stored per user:** Google profile (id, email, name, picture URL), connected accounts (email, granted scopes, status, encrypted tokens), settings, sessions (hashed id, user-agent, timestamps), an AI access log (feature, thread ids, encrypted subjects, counts), a security log (event type, small non-content detail), rate-limit counters, pending Copilot plans (see below), snoozes/reminders (account, thread id, kind and due time only), the Read later list (account, thread id and when it was added only), and templates (saved replies the user wrote: name, subject and text, AES-GCM encrypted with purpose `template` and bound to the user and row), and private notes on conversations (account, thread id and the user's text, AES-GCM encrypted with purpose `note` and bound to the user, account and thread; never sent to Gmail or the AI). See `server/db/schema.ts`.
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

Bulk actions (`POST /api/mail/bulk`) accept at most 100 conversations and one allowlisted action per request, check that every account belongs to the signed-in user, are limited to 30 requests per minute, and never delete permanently: "Delete" moves conversations to Trash.

## Unsubscribe assistant (outbound requests)

- **Nothing automatic.** Scanning only reads message metadata (From, Date, `List-Unsubscribe`, `List-Unsubscribe-Post`, labels) and stores nothing. Unsubscribing and archiving happen only on a user click, and the API requires `confirm: true`. The mailto method and archiving also go through a confirm dialog that shows exactly what will happen. The AI has no access to these routes.
- **Headers are untrusted.** For an action the client sends only the account and message id. The server re-reads the header from Gmail, so a client can't supply its own URL or address. Mailto targets must be a single valid address, and subject/body values have CR/LF and control characters removed. The sent message is built with the normal header-safe MIME builder and has no Cc/Bcc. Sender filters for archiving are zod-validated plain addresses, so they can't change the Gmail query.
- **SSRF protection for one-click (RFC 8058).** `server/lib/oneClick.ts` sends a single `POST List-Unsubscribe=One-Click` with no cookies or credentials, a 10 s timeout, no redirects, and discards the response body. It only allows `https` on port 443, with no userinfo and no IP-literal private hosts or local names. Every resolved address is checked against private, loopback, link-local, CGNAT, multicast, documentation, ULA, IPv4-mapped/compatible, 6to4 and Teredo ranges in the socket's `lookup` hook, so DNS rebinding can't reach an internal address. The local HTTP fake is allowed only outside production.
- Unsubscribes are logged in the security log as `newsletter_unsubscribed` with the method and sender domain only.

## Voice dictation

Dictation uses the browser's Web Speech API. FLUENT doesn't capture, upload or store audio, and the server never sees it. The browser may use its own speech service unless on-device recognition is available. FLUENT uses on-device recognition when Chrome reports it available. Recognised text is handled like typed text. Spoken commands can only create a draft in the composer, which is saved to Gmail Drafts; sending always needs the user's own click on Send.

## Installable app and service worker

The service worker (`public/sw.js`) caches only the static app shell (`index.html`, hashed JS/CSS, icons, manifest). It never intercepts `/api/*`, `/_vercel/*` or cross-origin requests, so no email data, tokens or API responses are written to the browser cache, and the OAuth redirect flow always goes to the network. `sw.js` is served with `no-cache` so updates aren't held back.

## Rendering untrusted email

1. HTML is sanitised with DOMPurify. Scripts, frames, forms, SVG/MathML, `srcset`/`ping`, event handlers, `javascript:`/`data:` and root-relative links are removed, as is `position:fixed`.
2. **Remote images are blocked by default** (`<img>`, CSS `url()`, `@import`) to defeat tracking pixels. The user can allow them per message or change the default in Settings. Inline `cid:` images are resolved from the message's own attachments.
3. The result is rendered in an `<iframe sandbox>` **without `allow-scripts`** (only `allow-same-origin` for height measurement plus `allow-popups` so links open in a new tab) with its own CSP: `default-src 'none'`, plus images limited to `data:` (and `https:` only when allowed).
4. The app itself is served with a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`).

## AI safety

- **The model has no tools.** AI endpoints only return text or structured data (summaries, drafts, Gmail queries, answers, Copilot plans). Model output never triggers a Gmail change by itself. Every change requires a user click.
- **Copilot actions (plan → preview → confirm).** `POST /api/copilot/plan` asks the model to turn the user's instruction into a typed plan. Allowed action types: search, archive/unarchive, star/unstar, mark read/unread, add/remove/create label, move to Trash, draft a reply or new email, and send. Anything else fails zod validation. The planner sees **only the user's instruction, label names and account addresses, never email content**, so text inside an email cannot add actions or change targets. `server/copilot/plan.ts` (`validatePlan`) then enforces:
  - at most 5 actions;
  - send actions are downgraded to drafts unless the user's own words say "send";
  - a new email may only be addressed to an address the user typed;
  - labels must be valid user label names;
  - queries may not contain control characters.

  The server resolves targets with real Gmail queries scoped to the user's own accounts. It drops threads covered by privacy exclusions and caps each action at 50 conversations (5 drafts). Reply recipients, subject and threading headers come from Gmail metadata, not the model; the model only writes the body text. The preview (affected senders and subjects, counts, full draft text) is stored encrypted (AES-GCM, purpose `copilot`, bound to the user id) in `copilot_plans`. A plan is bound to the user **and** the session, expires after 10 minutes, and is single-use: confirming claims it atomically with `UPDATE … WHERE used_at IS NULL AND expires_at > now()`, which also wipes the stored payload. Expired and used plans are deleted whenever a new plan is created, and with the user's data.
- **Confirm executes exactly the stored plan.** The AI is never called again at confirm. The client can only *deselect* items: any key not in the stored plan is rejected with 400 before the plan is consumed. Account ownership is re-checked. Trash requires `confirmTrash: true` and send requires `confirmSend: true` (the UI shows the conversation count or the full email plus an extra checkbox). Results are reported per action. Archive, star, read state, labels and Trash can be undone for 10 minutes through a single-use undo token with the same bindings. The confirm and undo endpoints are behind the CSRF check; planning is rate-limited to 10/min and execution to 20/min per user. The privacy audit log records `copilot_plan`, `copilot_execute` and `copilot_undo` with thread ids and encrypted subjects only, never bodies.
- AI-written text is clearly marked. Before sending it, the UI requires an explicit confirmation dialog. The send API also refuses messages flagged `aiGenerated` without `aiConfirmed` (`409 ai_confirmation_required`). That check depends on the client's flag. The real guarantee is that the only AI-to-send path is a Copilot plan the user confirms twice: once for the plan (with the full email shown) and once more for the send itself (`confirmSend`).
- **Prompt-injection defences.** Email content goes into the prompt only inside `<email …>` blocks. Delimiter-like strings in email content are neutralised, and a non-overridable system preamble tells the model to treat that content as untrusted data and to flag manipulation attempts. Structured outputs are validated with zod. Gmail queries returned by the model are checked for newlines.
- **Ask your inbox.** The question is planned in a separate call that sees only the user's own words. That call returns up to 3 Gmail queries, and each one goes through `validateGmailQuery`: single line, at most 300 characters, balanced quotes and parentheses, an allowlist of operators (`from:`, `subject:`, `after:` …) with well-formed values. Anything else (URLs, unknown operators, `after:yesterday`) is dropped. If every query is rejected, a plain keyword query built from the question is used. If no mail matches, FLUENT returns the "nothing found" message without calling the answer model. There is no fallback to unrelated recent mail. The answer model sees only the top matches, as untrusted `<email>` blocks, and must cite refs. Citations are mapped only onto emails actually supplied, made-up refs are dropped, and an answer with no valid citation is reported as not found. Asks are rate-limited to 10/min per user and logged as `ask_inbox`.
- **Daily brief.** `GET /api/ai/brief` builds the brief from Gmail metadata and snippets of the last 14 days of inbox mail, after privacy exclusions. It is generated once per user, local day (from the browser's IANA time zone) and scope. It is cached in `daily_briefs`, encrypted with AES-GCM (purpose `brief`, bound to user, day and scope). A hash of the exclusions and language is stored with it, so changing privacy settings forces a fresh brief. Cache hits don't call the model or add audit entries. Briefs older than 2 days are deleted, and clearing the AI history deletes them too. Server rules the model can't override: starred, important and non-inbox mail is never offered for archiving, and "awaiting reply" never includes threads where the user wrote last. The one-click archive goes through the normal `/mail/bulk` endpoint after a confirm dialog, with Undo. Reads are rate-limited to 60/min per user, and regenerations to 5/min.
- **Exclusions** (senders, domains, labels) are enforced on the server before any provider call: thread features return `403 ai_excluded`, and list features (overview, ask, search results) drop excluded threads. Turning AI off returns `403 ai_disabled` everywhere.
- Requests to xAI and OpenAI set `store: false`. The Gemini API has no such flag: Google keeps paid-tier prompts and responses for a limited time only to detect abuse. **On Gemini's free tier, Google may use prompts and responses to improve its products, and human reviewers may read them.** Use a paid (billing-enabled) key before real users' email goes through FLUENT, and keep the free tier for development with test mailboxes. The **AI access log** records feature, time, thread ids and encrypted subjects only, honours the user's retention setting (0 = off) and can be cleared.

## Phishing and fake-invoice guard

Every received message is checked on the server without AI (`server/security/phish.ts`). The checks cover Gmail's SPF/DKIM/DMARC results (only the topmost `mx.google.com` Authentication-Results header is trusted, so a forged lower header can't vouch for itself), lookalike and punycode sender domains, brand names sent from other domains, Reply-To on another domain, links whose visible address differs from where they actually go, IP and shortened links, risky attachment types, requests for passwords, pressure tactics, and the "our bank details changed" invoice pattern. Each signal carries a plain-language reason that the reader shows in a warning banner. "Ask Copilot to check" sends those server facts as trusted context, with the email itself as untrusted data, and gets a plain-language verdict and advice back. That check is logged as "Phishing check" in the AI access log. FLUENT never opens links or attachments to check them.

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
- **Web analytics:** Vercel Web Analytics (cookieless) runs only in builds made on Vercel. A `beforeSend` filter (`web/src/lib/analytics.ts`) drops query strings and fragments, collapses thread URLs to `/app/<folder>/thread`, maps unknown paths to a generic value and drops custom events. No email content, addresses, search terms or ids are sent. The script and beacon are same-origin (`/_vercel/insights/*`), so the existing CSP (`script-src 'self'`, `connect-src 'self'`) allows them.
- The AI provider's own data handling is governed by its API terms. FLUENT only controls what it sends. With the default Gemini provider this depends on the key's tier (see the AI safety section above).

## Reporting

Security contact: to be added by the owner (see the placeholders in `web/src/pages/Legal.tsx`).

## IMAP/SMTP accounts (app passwords and outbound connections)
- **App passwords:** the password, username and server names are stored as one AES-GCM blob in `accounts.credentials_enc`. The purpose is `mail-credentials` and the AAD is `userId:providerAccountId`. They're never returned by the API or logged. Connection errors log only an error code.
- **Server checks:** server names must be DNS names; IP literals, ports and userinfo are rejected by zod. Ports are limited to 993 (IMAP/TLS), 465 (SMTP/TLS) and 587 (SMTP with required STARTTLS). TLS 1.2+ is required, with certificate checks against the server name.
- **SSRF and DNS rebinding:** `pinMailServer` resolves the name once and refuses the server if *any* address is private, loopback, link-local, CGNAT, multicast, documentation or reserved. This uses the same BlockList as the unsubscribe fetch, including IPv4-mapped, 6to4, Teredo and NAT64 forms. The socket then connects to that exact IP (SNI = the name), so a second DNS answer can't redirect it.
- **Test fakes:** `FLUENT_TEST_MAIL_PORTS` routes `*.fluent.test` to plaintext fakes on 127.0.0.1. It is ignored when `NODE_ENV=production`.
- **Rate limits:** connecting an account is limited to 5 attempts a minute per user, since each attempt logs in to two servers. Accounts are capped at 10 per user. Every query is still scoped by `getOwnedAccount` (404 for other users' accounts).
- **No automatic sending:** nothing is sent without the existing send endpoint and its AI-confirmation rule.
