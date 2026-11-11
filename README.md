<div align="center">

# MailIQ

**An AI email client for Gmail. It summarizes threads, drafts replies and answers questions about your inbox, and you approve every send.**

</div>

![MailIQ reader with an AI summary](docs/screenshots/04-reader-ai-summary.png)

<sub>Screenshots come from the automated end-to-end suite and show test fixture data, not a real mailbox.</sub>

## What it is

MailIQ is a fast, keyboard-friendly, three-pane mail client for one or more Gmail accounts, with AI built into the reading and writing flow. It talks to Gmail through Google's official API and does not store your messages. The AI never acts on its own. Copilot can propose actions, but it shows you the exact plan first and nothing changes until you confirm.

## Features

**Mail**
- A unified inbox across several connected Gmail accounts, with Primary/Promotions/Social/Updates/Forums categories, a starred group, date grouping and infinite pagination
- Folders (Inbox, Starred, Important, Sent, Drafts, Archive, Spam, Trash, All mail) and Gmail labels, including create, rename and delete
- A reader with threaded messages, sanitised HTML in a sandboxed iframe, **remote images and trackers blocked by default**, attachments and inline images
- Actions synced to Gmail: archive, trash/restore, spam, read/unread, star, important, label, move to inbox
- Compose with rich text (TipTap), CC/BCC, attachments, autosaved Gmail drafts, and reply, reply-all and forward with correct threading
- Search with Gmail syntax, plus **natural-language search** ("invoice I got last month") that shows the generated Gmail query
- Gmail filters: create and delete
- **Multi-select and bulk actions**: hover an avatar to get a checkbox, shift-click to select a range, `x` to select and `Esc` to clear, or long-press on mobile. The action bar can archive, mark read or unread, snooze, label, or move to Trash (asks "Move 5 emails to Trash?"). Every bulk action can be undone. On the server it runs as a validated, rate-limited batch endpoint (`users.messages.batchModify`, max 100 conversations).
- Polling-based sync with in-app and desktop notifications
- **Undo send**: messages wait 5 s by default (off, 5, 10 or 20 s in Settings → Appearance) with an Undo button. Leaving the page during the window asks first.
- **Snooze** (later today, tomorrow, weekend, next week) into a Snoozed folder, and **remind me if no reply** for sent mail. Both return automatically on the next sync after they are due, so no cron is needed.
- **Follow-up radar** in the AI Overview: sent mail still waiting on a reply, and questions you haven't answered, with one-click drafted nudges (confirm first)
- Keyboard shortcuts (`j`/`k`, `e`, `#`, `r`, `c`, `/`, `x`, `z`, `g i`, `g o`, `?`), a **⌘K command palette** (go anywhere, run conversation actions, or ask Copilot), **⌘J** for Copilot, and dark (default), light or system theme
- **Private notes**: pin a note only you can see to any conversation (`n` or ⌘K). Notes are encrypted with AES-256-GCM and bound to your user and the thread.
- **Unsubscribe assistant**: lists newsletter senders, least-opened first. On your click it can one-click unsubscribe (RFC 8058, with SSRF-safe outbound requests), send a mailto unsubscribe, or archive everything from a sender (with undo).
- **Voice dictation** in the composer and Copilot (Web Speech API). Spoken commands only ever create a draft.
- **Accent colours** (purple, blue, teal, rose, orange), each checked for WCAG AA contrast in light and dark. **Focus mode** shows only important mail for 30 minutes, 1 hour or until tomorrow morning. Both are in Settings and ⌘K. Toasts follow the light or dark theme and stay clear of the composer's bottom bar.
- **Installable app (PWA)**: add MailIQ to your home screen on Android or iOS. It has a manifest, icons and safe-area support. The service worker caches only the static app shell and never `/api` or email.

**AI** (Google Gemini by default, with xAI Grok or OpenAI as options, through the Vercel AI SDK)
- A thread summary with key points, action items, deadlines and quick replies
- **Long-thread digest**: on conversations with 4+ messages the summary adds "who wants what", what's been decided and what's still open
- **Phishing guard**: every received message is checked on the server for failed SPF/DKIM/DMARC, lookalike sender domains (paypa1.com), mismatched or raw-IP links and urgent payment language. Risky mail shows a plain-language banner, and "Ask Copilot why" gives a short AI explanation.
- **Swipe to reply (mobile)**: swipe a conversation left to open it with the reply box focused and three short AI-suggested replies. Tapping one fills an editable draft. Nothing is sent until you press Send and confirm.
- "Explain this email simply" and questions about a specific thread
- Draft new emails or replies from an instruction, then make them shorter or longer, fix grammar, or change the tone
- **Ask your inbox** ("what did Ola say about the invoice in October?"): the AI turns the question into up to three Gmail searches, and each one is validated against an allowlist of operators before it runs. MailIQ reads the top matches and answers in your language with clickable sources. If nothing matches, it says so instead of guessing. The Gmail query is shown, and every ask is audit-logged and rate-limited. Open it from Copilot or from ⌘K → "Ask your inbox".
- **Daily brief**: the first time you open MailIQ each day, Copilot writes a morning summary in your language. It covers the most important new mail, what's waiting on your reply, and what's safe to archive, with one-click Archive (confirm, then undo). The brief sits at the top of the inbox and in the AI Overview. It is generated on demand (no cron) and cached encrypted per user per day. Your privacy exclusions apply, and starred or important mail is never suggested for archiving.
- **Calm, Gmail-like layout**: a single search pill, a small section switcher (Primary, Promotions, Social, Updates, Forums, Unread) instead of chips, a one-line dismissible daily brief, quiet rows with the star on the right and a small unread dot, one Compose button on mobile, and a muted palette where the accent is kept for primary actions
- **Copilot, front and centre**: one calm "Search or ask Copilot" pill at the top of every mail list (plain text searches Gmail, a question or the sparkle button goes to Copilot, "Smart search" turns plain language into a Gmail query), ⌘J anywhere, "Ask Copilot about this email" in the reader, a full-screen Copilot sheet on mobile, and a wide panel you can expand to a large centered view
- **Copilot actions**: tell it what to do ("archive newsletters from this week", "star everything from Sofia", "draft follow-ups"). It shows a plan with every affected conversation and the full draft text. Nothing runs until you confirm, Trash and send need an extra confirmation, and archive, star, read and label changes can be undone.
- **AI Overview**: a daily briefing of what needs a reply, what you're waiting on, deadlines and important mail. A Gmail-only triage still works without AI.
- A mandatory confirmation step before any AI-written text is sent

**Privacy dashboard**
- An AI access log showing when each feature ran and which emails (by subject and id, never body) it read
- Exclude senders, domains or labels from AI. Exclusions are enforced on the server before any AI call.
- AI history retention (off, 7, 30, 90 or 365 days) and a one-click clear
- A list of everything MailIQ stores, a JSON export (without tokens), and deletion of all your data (Google tokens revoked)

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

**Copilot, follow-ups, snooze and bulk actions**

<table>
<tr>
<td><img src="docs/screenshots/24-inbox-ask-copilot-bar.png" alt="Search or ask Copilot from one pill in the inbox" /></td>
<td><img src="docs/screenshots/25-copilot-expanded.png" alt="Copilot expanded with a plan" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/15-copilot-plan-preview.png" alt="Copilot plan preview" /></td>
<td><img src="docs/screenshots/16-copilot-result.png" alt="Copilot result with Undo" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/20-radar-nudge.png" alt="Follow-up radar nudge" /></td>
<td><img src="docs/screenshots/26-bulk-select.png" alt="Multi-select bulk actions" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/21-snooze-menu.png" alt="Snooze menu" /></td>
<td><img src="docs/screenshots/23-command-palette.png" alt="Command palette" /></td>
</tr>
<tr>
<td><img src="docs/screenshots/30-daily-brief.png" alt="Daily brief at the top of the inbox" /></td>
<td><img src="docs/screenshots/31-ask-inbox.png" alt="Ask your inbox with cited sources" /></td>
</tr>
</table>
<p align="center"><img src="docs/screenshots/18-mobile-copilot-plan.png" alt="Mobile Copilot sheet" width="260" /> <img src="docs/screenshots/27-mobile-bulk-bar.png" alt="Mobile bulk action bar" width="260" /> <img src="docs/screenshots/29-mobile-swipe-reply.png" alt="Swipe-to-reply suggestions" width="260" /></p>

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
React SPA ──/api──► Hono (Vercel Function) ──► Postgres  (users, accounts*, sessions#, settings, ai_audit*, security_events, rate_limits, daily_briefs*)
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

MailIQ is in preview. Before a public launch, the owner still needs to fill in the operator name and contact in the privacy policy and terms (`web/src/pages/Legal.tsx`), complete Google verification and CASA, and configure production environment variables.
