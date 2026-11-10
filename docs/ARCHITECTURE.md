# Architecture

```
Browser (React SPA, /  /privacy  /terms  /app/*)
   │  fetch /api/*  (same origin, session cookie + X-CSRF-Token)
   ▼
Vercel Function  api/index.ts  ──►  Hono app (server/app.ts, basePath /api)
   │                                   ├─ middleware: secure headers, metadata-only request logging, session, CSRF, rate limits, error mapper
   │                                   ├─ /auth      Google OAuth (PKCE), sessions, logout
   │                                   ├─ /mail      threads, thread actions, labels, filters, attachments, sync, drafts list
   │                                   ├─ /compose   send, drafts CRUD
   │                                   ├─ /ai        insights, draft, rewrite, search, ask, copilot, overview
   │                                   └─ /settings, /security/*, /accounts, /privacy/*, /me
   ├──► PostgreSQL (Drizzle, postgres.js)  users · accounts · sessions · user_settings · ai_audit · security_events · rate_limits
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
| `shared/` | Types and zod schemas shared by web and server (`mail.ts`, `settings.ts`). |
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
