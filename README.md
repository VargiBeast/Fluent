<div align="center">

# FLUENT

**An AI email client for Gmail. It summarizes threads, drafts replies and answers questions about your inbox, and you approve every send.**

</div>

![FLUENT reader with an AI summary](docs/screenshots/04-reader-ai-summary.png)

<sub>Screenshots come from the automated end-to-end suite and show test fixture data, not a real mailbox.</sub>

## What it is

FLUENT is a fast, keyboard-friendly, three-pane mail client for one or more Gmail accounts, with AI built into the reading and writing flow. It talks to Gmail through Google's official API and does not store your messages. The AI only ever produces text for you to review: it cannot send, delete or forward anything on its own.

## Features

**Mail**
- A unified inbox across several connected Gmail accounts, with Primary/Promotions/Social/Updates/Forums categories, a starred group, date grouping and infinite pagination
- Folders (Inbox, Starred, Important, Sent, Drafts, Archive, Spam, Trash, All mail) and Gmail labels, including create, rename and delete
- A reader with threaded messages, sanitised HTML in a sandboxed iframe, **remote images and trackers blocked by default**, attachments and inline images
- Actions synced to Gmail: archive, trash/restore, spam, read/unread, star, important, label, move to inbox
- Compose with rich text (TipTap), CC/BCC, attachments, autosaved Gmail drafts, and reply, reply-all and forward with correct threading
- Search with Gmail syntax, plus **natural-language search** ("invoice I got last month") that shows the generated Gmail query
- Gmail filters: create and delete
- Polling-based sync with in-app and desktop notifications
- **Snooze** (later today, tomorrow, weekend, next week) into a Snoozed folder, and **remind me if no reply** for sent mail. Both return automatically on the next sync after they are due, so no cron is needed.
- **Follow-up radar** in the AI Overview: sent mail still waiting on a reply, and questions you haven't answered, with one-click drafted nudges (confirm first)
- Keyboard shortcuts (`j`/`k`, `e`, `#`, `r`, `c`, `/`, `g i`, `g o`, `?`, `⌘K` for Copilot) and dark (default), light or system theme

**AI** (Google Gemini by default, with xAI Grok or OpenAI as options, through the Vercel AI SDK)
- A thread summary with key points, action items, deadlines and quick replies
- "Explain this email simply" and questions about a specific thread
- Draft new emails or replies from an instruction, then make them shorter or longer, fix grammar, or change the tone
- **Ask your inbox / Copilot**: answers grounded in your emails, with links to the sources
- **Copilot actions** (⌘K): tell it what to do ("archive newsletters from this week", "star everything from Sofia", "draft follow-ups"). It shows a plan with every affected conversation and the full draft text. Nothing runs until you confirm, Trash and send need an extra confirmation, and archive, star, read and label changes can be undone.
- **AI Overview**: a daily briefing of what needs a reply, what you're waiting on, deadlines and important mail. A Gmail-only triage still works without AI.
- A mandatory confirmation step before any AI-written text is sent

**Privacy dashboard**
- An AI access log showing when each feature ran and which emails (by subject and id, never body) it read
- Exclude senders, domains or labels from AI. Exclusions are enforced on the server before any AI call.
- AI history retention (off, 7, 30, 90 or 365 days) and a one-click clear
- A list of everything FLUENT stores, a JSON export (without tokens), and deletion of all your data (Google tokens revoked)

**Public site**: a landing page at `/`, plus [`/privacy`](web/src/pages/Legal.tsx) (covering Gmail scopes, the Google API Services User Data Policy and Limited Use, AI handling, retention and deletion) and `/terms`.

<table>
<tr>
<td><img src="docs/screenshots/01-landing-desktop.png" alt="Landing page" /></td>
<td><img src="docs/screenshots/06-overview.png" alt="AI Overview" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/03-inbox-desktop.png" alt="Unified inbox" /></td>
<td><img src="docs/screenshots/08-privacy-dashboard.png" alt="Privacy dashboard" /></td>
</tr>
</table>
<p align="center"><img src="docs/screenshots/10-mobile-inbox.png" alt="Mobile inbox" width="260" /> <img src="docs/screenshots/11-mobile-reader.png" alt="Mobile reader" width="260" /></p>

## Stack

| Layer | Technology |
| --- | --- |
| Web | React 19, TypeScript, Vite, Tailwind CSS v4, a small in-repo component system on Radix primitives, TanStack Query, React Router, TipTap, DOMPurify |
| API | TypeScript on Node.js, Hono, served as a single Vercel Function (`api/index.ts`) |
| Data | PostgreSQL, Drizzle ORM and SQL migrations (Supabase or any Postgres 14+) |
| Auth | Google OAuth 2.0 server-side code flow with PKCE, state and nonce; httpOnly cookies; CSRF tokens |
| Mail | Gmail REST API v1 |
| AI | Vercel AI SDK with `@ai-sdk/google` (default `gemini-3.5-flash-lite`), switchable to `@ai-sdk/xai` (`grok-4.7`) or OpenAI by env. The Gemini free tier is for development only; see [SETUP](docs/SETUP.md#5-ai). |
| Quality | zod everywhere, pino structured logs (no email content), ESLint, Vitest, Playwright |

## Architecture

```
React SPA ──/api──► Hono (Vercel Function) ──► Postgres  (users, accounts*, sessions#, settings, ai_audit*, security_events, rate_limits)
                                      ├──► Google OAuth + Gmail API   (* = AES-256-GCM encrypted fields, # = hashed ids)
                                      └──► AI provider (Gemini)       — email bodies are never stored
```

One web app and one API live in a single pnpm package. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start

```bash
corepack enable
pnpm install
cp .env.example .env          # set DATABASE_URL, TOKEN_ENCRYPTION_KEY, Google OAuth + Gemini keys
pnpm db:migrate               # apply SQL migrations
pnpm dev                      # API :8787 + web http://localhost:5173
```

Without Google or AI credentials the app still runs and clearly says what isn't configured. It never shows fake data. Full instructions: [docs/SETUP.md](docs/SETUP.md).

## Testing

```bash
pnpm typecheck                # web + server tsconfigs
pnpm lint
pnpm test                     # unit + web (jsdom) + integration (needs a throwaway Postgres; see SETUP)
pnpm e2e                      # Playwright: desktop 1440x900 and mobile 390x844, with screenshots
pnpm check                    # typecheck + lint + tests + build
```

Gmail, Google OAuth and the AI provider are replaced **only in tests** by HTTP-level fakes (`tests/fakes/`). The integration and E2E suites run the real API against a real Postgres.

## Deploying to Vercel

The repository includes `vercel.json` (build, function, SPA rewrites and security headers). Set the environment variables listed in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), run `pnpm db:migrate` against the production database, and register `https://<your-domain>/api/auth/google/callback` as an OAuth redirect URI.

## Google OAuth and Gmail

1. Enable the Gmail API in a Google Cloud project.
2. Configure the consent screen with the `/privacy` and `/terms` URLs.
3. Add the scopes `openid email profile gmail.modify gmail.settings.basic`.
4. Create a Web OAuth client with your redirect URIs.

`gmail.modify` and `gmail.settings.basic` are **restricted scopes**. Until Google's **OAuth app verification** and an annual **CASA security assessment** are complete, the app can only be used by test users listed on the consent screen. See [docs/SETUP.md](docs/SETUP.md#4-google-cloud-real-gmail) and [docs/SECURITY.md](docs/SECURITY.md#google-oauth-verification-and-casa).

## Security and privacy

- Email content is never written to the database. It is fetched live from Gmail.
- OAuth tokens are encrypted with AES-256-GCM (HKDF sub-keys, AAD-bound). Session ids are hashed. Cookies are httpOnly, `__Host-`/Secure on HTTPS and SameSite=Lax. Mutations require same origin plus a CSRF token.
- Per-user isolation is checked on every account and thread id, with RLS lockdown on Supabase. Inputs are validated with zod and protected by Postgres-backed rate limits.
- Untrusted HTML is sanitised and rendered in a script-less sandboxed iframe with its own CSP. Remote images are blocked by default.
- The AI has no tools. Email content is delimited as untrusted data to resist prompt injection. Exclusions are enforced on the server, AI text requires confirmation before sending, and an auditable access log lets you clear history, export or delete your data.

Read the full model in [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

- [docs/SETUP.md](docs/SETUP.md): local setup, environment, Google Cloud, tests
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Vercel, environment variables, migrations, redirect URIs
- [docs/SECURITY.md](docs/SECURITY.md): threat model, controls, Google verification and CASA
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): code layout and request flows

## Status

FLUENT is in preview. Before a public launch, the owner still needs to fill in the operator name and contact in the privacy policy and terms (`web/src/pages/Legal.tsx`), complete Google verification and CASA, and configure production environment variables.
