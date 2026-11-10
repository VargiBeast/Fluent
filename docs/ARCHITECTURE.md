# Architecture

```
Browser (React SPA, /  /privacy  /terms  /app/*)
   │  fetch /api/*  (same origin, session cookie + X-CSRF-Token)
   ▼
Vercel Function  api/index.ts  ──►  Hono app (server/app.ts, basePath /api)
   │                                   ├─ middleware: secure headers, metadata-only request logging, session, CSRF, rate limits, error mapper
   │                                   ├─ /auth      Google OAuth (PKCE), sessions, logout
   │                                   ├─ /mail      threads, thread actions, labels, filters, attachments, sync, drafts list, read-later
   │                                   ├─ /compose   send, drafts CRUD
   │                                   ├─ /ai        insights, draft, rewrite, search, ask, copilot, overview
   │                                   ├─ /copilot   plan (AI → typed plan + preview), plans/:id/execute|cancel, undo/:id
   │                                   ├─ /templates saved replies CRUD (per user, encrypted)
   │                                   ├─ /send-as   Gmail send-as display name + signature (gmail.settings.basic)
   │                                   ├─ /stats     inbox stats from live Gmail metadata
   │                                   └─ /settings, /security/*, /accounts, /privacy/*, /me
   ├──► PostgreSQL (Drizzle, postgres.js)  users · accounts · sessions · user_settings · ai_audit · security_events · rate_limits · copilot_plans · snoozes · templates · read_later · thread_notes
   ├──► Google  (OAuth token/JWKS/revoke, Gmail REST v1)
   └──► AI provider via Vercel AI SDK (Google Gemini by default; xAI or OpenAI optional)
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `web/` | Vite root. `web/src/main.tsx` holds the router. Public pages live in `web/src/pages`, and the `/app` tree in `web/src/app` (lazy-loaded as its own chunk). |
| `web/src/components/ui` | The small in-repo component system: Button, IconButton, Field/Input/Switch, Dialog/ConfirmDialog, Menu, Avatar, Chip, Badge, Skeleton, EmptyState, Card and Logo. It is built on Radix primitives and Tailwind v4 design tokens (`web/src/styles/index.css`). |
| `web/src/lib` | API client (CSRF header), session/theme provider, TanStack Query hooks with optimistic thread actions, sanitizer, compose helpers and settings mutation. |
| `server/` | Hono API: `routes/`, `services/` (Gmail-backed mail operations), `gmail/` (client with token refresh, parsers, MIME builder), `ai/` (core guardrails, policy/audit, features), `auth/`, `db/`, `lib/` (errors, CSRF, rate limit). |
| `shared/` | Types and zod schemas shared by web and server (`mail.ts`, `settings.ts`, `copilot.ts`). |
| `api/index.ts` | Vercel entry: `hono/vercel` handlers for all methods. |
| `drizzle/` | SQL migrations and the Drizzle journal. |
| `tests/` | `unit/`, `web/` (jsdom), `integration/` (real Postgres + HTTP fakes), `e2e/` (Playwright), `fakes/` (fake Google OAuth/OIDC, Gmail, Gemini and xAI servers plus seed mailbox). |

## Key flows

**Sign-in.** `/api/auth/google/start` creates the state, PKCE verifier and nonce, seals them into a cookie and redirects to Google. `/callback` validates everything, exchanges the code, verifies the ID token, upserts the user and account (tokens encrypted), creates a session and redirects to `/app/onboarding` (first time) or the requested `next` path. With `mode=link`, an additional Gmail account is attached to the signed-in user.

**Unified inbox.** `GET /mail/threads` fans out to each connected account (`threads.list` plus bounded-concurrency `threads.get?format=metadata`), merges by date and pages with a composite cursor holding each account's `pageToken`. Folders and categories map to Gmail label queries. The client caches pages with TanStack Query. Actions (`star`, `archive`, `trash`, …) are applied optimistically and synced through `threads.modify`/`trash`, with rollback on error.

**Sync.** The SPA polls `GET /mail/sync` about every 45 s while visible. The server calls `history.list` from each account's stored `historyId` and reports changes and new inbox mail. The client then invalidates queries and shows in-app or desktop notifications based on settings.

**Reader.** `GET /mail/threads/:account/:thread` fetches the full thread and parses MIME (charset decoding, inline images, attachments). The client sanitises the HTML and renders it in a sandboxed iframe. Attachments stream through `/mail/attachments/...` with `Content-Disposition: attachment` and `nosniff`.

**Compose.** TipTap editor, recipients with validation, CC/BCC, attachments (≤ 3.5 MB total), autosaving Gmail drafts, reply/reply-all/forward with correct threading headers. The server builds RFC 5322 MIME (multipart/alternative, UTF-8 encoded headers) and calls `messages.send` or `drafts.send`.

**AI.** `server/ai/core.ts` wraps `generateText` from the AI SDK with a fixed guard preamble, a `TASK:` marker, delimited untrusted email blocks, zod structured output and error mapping (`502 ai_unavailable`). `server/ai/policy.ts` loads the user's AI settings (enabled, exclusions, retention), checks exclusions before every call and writes the audit log. `server/ai/features.ts` implements insights, explain, thread Q&A, draft, rewrite, natural-language search (query translation plus optional "unanswered" post-filter), ask-your-inbox (search, then read the top threads, answer, then validate citations) and the overview (deterministic Gmail triage that works without AI, plus AI ranking over subjects and snippets).

**Settings and privacy.** `server/routes/settings.ts` provides settings patch/merge, sessions, security events, account disconnect (with token revocation), AI access log list/clear (retention enforced on reads, writes and session loads), stored-data summary, JSON export and full deletion.

## Configuration states

`GET /api/config` reports `{ google, ai, database, aiProvider }`. The landing page disables sign-in when Google isn't configured. AI surfaces show "not configured" or "turned off" states, and the overview falls back to Gmail-only triage. No feature substitutes fake data.

## Testing strategy

- **Unit:** crypto (AES-GCM, HKDF purposes, AAD binding), OAuth helpers (safe `next`, PKCE), MIME builder and header-injection guards.
- **Web (jsdom):** sanitizer (XSS vectors, link rewriting, tracker blocking, cid images) and the iframe CSP.
- **Integration:** the real Hono app against a real Postgres, with HTTP-level fakes for Google OAuth/OIDC (PKCE verification, JWKS-signed ID tokens, refresh/revoke), Gmail REST, the Gemini generateContent API and the xAI Responses API. Covers auth/CSRF/sessions, mail, compose, AI features, exclusions, audit/retention, export/delete and cross-user isolation.
- **E2E (Playwright):** the built SPA plus API against the same fakes, at 1440×900 and 390×844, with screenshots.

## Copilot actions

1. `POST /api/copilot/plan {instruction, context?}`. The planner model (task `plan`, `server/copilot/plan.ts`) sees only the instruction, label names and account addresses. It returns `intent` (actions, question or unclear) plus up to 5 typed actions. Questions are routed to "Ask your inbox" (or the open-thread Q&A), and unclear requests get a clarifying reply.
2. `validatePlan` enforces the allowlist and caps, downgrades send to draft unless the user said "send", and requires typed recipients for new emails.
3. `server/copilot/service.ts` resolves each action with `listThreads` (≤ 50, excluded threads removed, already-applied threads skipped) or the open thread. It drafts reply bodies with `draftEmail`; recipients and headers come from Gmail metadata. It then stores the plan encrypted in `copilot_plans` (10-minute TTL, bound to user and session) and returns a `PlanPreview`.
4. The UI (`web/src/app/copilot/Copilot.tsx`, `PlanCard`) shows the plan with per-action and per-conversation checkboxes. Trash and send get an extra confirmation. Copilot opens from the sidebar, the reader, the Overview or ⌘K / Ctrl+K (`copilot/context.tsx`).
5. `POST /api/copilot/plans/:id/execute {selections, confirmTrash?, confirmSend?}` validates that the selections are a subset of the plan, claims it atomically, runs the Gmail calls (labels, `threads.modify`, `threads.trash`, `drafts.create`, `messages.send`), returns per-action results and stores an inverse undo plan (`POST /api/copilot/undo/:id`).

## Snooze and reminders

`POST /api/mail/snoozes {accountId, threadId, until, kind}` stores a row in `snoozes`. For `snooze`, it also moves the thread out of the Inbox and adds the user label "Snoozed" (the Snoozed folder is `label:snoozed`). `remind` changes nothing in Gmail until it is due. There is no cron: every `/api/mail/sync` poll (about every 45 s while FLUENT is open) runs `processDueSnoozes`. That claims due rows with `DELETE … RETURNING`, so it is idempotent across tabs. A snooze returns to the Inbox unread. A reminder fires only if the user's message is still the last one: it is brought back to the Inbox, unread and starred. Anything due while FLUENT was closed comes back on the next load.

## Bulk actions

The thread list keeps a selection set (checkbox, shift-click range, `x`/`Esc`, long-press on mobile). The bulk bar calls `POST /api/mail/bulk`, which groups the conversations by account and runs label changes as one `users.messages.batchModify` per 1000 messages, and Trash/Restore per thread. The response includes the inverse action, which the Undo toast sends back to the same endpoint.

## PWA

`public/manifest.webmanifest`, icons in `public/icons/`, and `public/sw.js` (registered from `web/src/main.tsx` in production only). See SECURITY.md for exactly what the worker caches.

## Templates

Saved replies live in `templates` (name, subject and text, each AES-GCM encrypted with purpose `template` and AAD `userId:rowId`). `GET/POST /api/templates` and `PUT/DELETE /api/templates/:id` are scoped to the session user (another user's id returns 404) and validated by `shared/templates.ts` (single-line name and subject, at most 10,000 characters of text, 100 templates per user). In the composer, the Templates button or `⌘/Ctrl + ;` opens a searchable picker (`web/src/app/composer/TemplatePicker.tsx`) that inserts the text at the cursor as escaped paragraphs, and fills the subject only when it's empty. Templates are managed in Settings → Templates and included in the data summary and JSON export.

## Signatures and sender name

`GET /api/send-as` lists each connected account's Gmail send-as identities (`users.settings.sendAs.list`). `PATCH /api/send-as/:accountId/:email {displayName?, signature?}` updates one of them (`sendAs.patch`, scope `gmail.settings.basic`). The address must be one Gmail lists for that owned account, the name is single-line without `<>"`, and the signature (≤ 10,000 characters) is stripped of scripts, event handlers and `javascript:` links before it goes to Gmail. Nothing is stored in FLUENT's database; the change is logged as a security event (`gmail_sendas_updated`, no content). Mail sent from the composer uses the Gmail display name of the account's own address in `From:`, falling back to the Google profile name. Settings → Signatures & name previews the signature sanitised in a sandboxed iframe and edits it with TipTap; signatures with images or inline styling show a warning first, since the editor keeps only basic formatting. "Use this one in FLUENT too" copies a plain-text version into the composer signature (AI preferences).

## Inbox stats

`GET /api/stats?days=7|30|90&account=&tz=` (`server/services/stats.ts`) lists the conversations active in the window (`threads.list q=newer_than:Nd -in:chats -in:drafts`, up to 400 across accounts, most recent first) and reads them with `threads.get?format=metadata&metadataHeaders=From` (bounded concurrency). Only sender, date and labels are used and nothing is stored. `computeStats` (pure, unit-tested) buckets received and sent mail per calendar day (per week from Monday for 90 days) in the user's time zone, ranks the top 10 senders, builds an hour-of-day histogram, and measures response time from the first message you hadn't answered to your next reply in the same conversation (average, median and a distribution). Spam, Trash, drafts and chats are ignored. If the conversation cap is reached the response says so (`sample.truncated`) and the page shows it. Rate limited to 10/min per user. The page is `/app/stats` (`web/src/app/Stats.tsx`), with CSS bar charts and screen-reader tables.

## Read later

`POST /api/mail/read-later {accountId, threadId}` saves a conversation (the thread must exist in the user's own account; idempotent; up to 500), `DELETE /api/mail/read-later/:accountId/:threadId` removes it and `GET /api/mail/read-later` lists the saved keys. Rows in `read_later` hold only the account, thread id and time. Nothing changes in Gmail. `later` is a FLUENT folder: `GET /api/mail/threads?folder=later` is answered by `services/readLater.ts` with the same `ThreadPage` shape as Gmail folders (newest saved first, offset cursor, summaries fetched live with `threads.get?format=metadata`), so the normal list, reader and keyboard navigation work. Conversations deleted in Gmail are dropped from the list; trashed or spam ones are hidden until restored. The reader has a bookmark toggle (shortcut `b`) and the sidebar a Read later entry. The list is included in the data summary and export.

## Private notes

`GET/PUT/DELETE /api/notes/:accountId/:threadId` reads, saves (`{body}`, zod-validated, up to 5,000 characters) and deletes the one private note pinned to a conversation. The thread must exist in the user's own account. `thread_notes` holds the account, thread id and the text AES-GCM encrypted (purpose `note`, AAD = user + account + thread). Notes are never written to Gmail, never included in AI prompts, and are removed with the account (cascade). The reader shows the note under the subject (toolbar button or shortcut `n`). Notes are included in the data summary and export.

## Unsubscribe assistant

`GET /api/newsletters/senders?days=30|90|180&account=` lists up to 500 recent messages per account (`messages.list newer_than:Nd -in:sent -in:drafts -in:chats`), reads only their metadata headers, and groups those with a usable `List-Unsubscribe` by account + sender. Results are ranked by open rate (read ÷ total, least-opened first), then by volume. Each sender lists the unsubscribe methods its latest message offers: one-click (RFC 8058, https + `List-Unsubscribe-Post`), mailto, or an https page to open. Nothing is stored. The page (`/app/newsletters`, sidebar "Unsubscribe") also remembers which senders you unsubscribed from in localStorage only.

- `POST /api/newsletters/unsubscribe {accountId, messageId, method, confirm: true}` re-reads the header from Gmail. It then sends the one-click POST (`server/lib/oneClick.ts`, SSRF-guarded) or, after the confirm dialog, one unsubscribe email from the user's account.
- `POST /api/newsletters/archive {senders[], confirm: true}` archives every Inbox message from those senders (`from:<addr> in:inbox` + `messages.batchModify`) and returns the ids. `POST /api/newsletters/archive/undo` puts them back.
- See SECURITY.md for the threat model.
