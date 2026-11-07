# FLUENT progress log

Branch: `cursor/fluent-mvp-b1bc`

Source before this work: `main` at `e3f0dc1c473deb13681847adcd79d14295a3593d`.

## Phase 1 — Repository and architecture

Completed. Reinspected the scaffold. Kept Express, Vite, Drizzle, and the OpenAPI package. One API, not a second framework. Vercel hosts the same Express app through `api/[...path].ts`.

## Phase 2 — Foundation

Completed. Dark palette, shell, desktop and mobile navigation, login, onboarding, overview, inbox, thread, copilot, compose, settings, loading, empty, error, and confirmation states.

Files: `artifacts/mail/src/App.tsx`, `artifacts/mail/src/components/fluent/*`, `artifacts/mail/src/pages/*`, `artifacts/mail/src/index.css`.

## Phase 3 — Database and authentication

Completed in source. `lib/db/migrations/0001_init.sql` is the reviewed migration, with forced RLS and `fluent_app`. `drizzle-kit push` is disabled. Post-merge no longer pushes a schema. Sessions, CSRF, and separate Google sign-in are implemented. The migration has not been applied to a hosted database.

## Phase 4 — Gmail

Completed as an adapter. OAuth state, PKCE, encrypted refresh tokens, refresh, revoke, pagination, and error mapping exist. `gmail.modify` is documented as including send permission. The client allowlist rejects send, draft writes, and permanent delete. Live Gmail is blocked until Google credentials exist. No real mailbox was accessed.

## Phase 5 — Inbox

Completed for the labeled demo mailbox and for the Gmail adapter. Archive and trash require a one-time server approval. Trash is not permanent deletion.

## Phase 6 — AI

Completed. Mock adapter is labeled. Live adapter is OpenAI-compatible, tool-free, size-limited, and schema-checked. It is blocked without `AI_API_KEY`. No paid model call was made.

## Phase 7 — Design

Completed in the same UI pass: dark surfaces, 800px mobile nav, focus rings, skip link, reduced motion.

## Phase 8 — Tests

Executed:

- `pnpm --filter @workspace/api-server run test` — 19 passed, 0 failed.
- `pnpm --filter @workspace/mail run test` — 5 passed, 0 failed.
- `pnpm run typecheck` — passed.
- `pnpm --filter @workspace/api-server run build` — passed.
- `PORT=20126 BASE_PATH=/ pnpm --filter @workspace/mail run build` — passed.

UI tests are server render plus the stylesheet. A local Chrome session also opened the Vite app against the demo API and showed the blocked Google login, the demo banner, and the inbox on desktop and a 390px width. That was not a public deployment.

## Phase 9 — Deployment readiness

Docs and `vercel.json` are prepared. No Vercel project was created or deployed. No Supabase project was created or migrated.

## Design pass

Completed on this branch after `a4d5761`. Central tokens in `artifacts/mail/src/fluent.css`. Public introduction at `/`. Inbox gained filters, categories, star/read, and next page. Sent search stays in Sent. Drafts can be listed, reopened, and updated. Mobile More sheet includes Sent. Visual QA is in `docs/design/RESPONSIVE_QA.md`.

The least-privilege database issue, live-model grounding, and hosting gaps from the independent audit were not treated as fixed.

## Design QA completion

Login is a centered pair of equal panels. Mobile Compose sits in the bottom bar, and the message list scrolls in the region above that bar. The signed-in matrix is 50/50 at 320, 390, 768, 1366, and 1920. Details are in `docs/design/RESPONSIVE_QA.md`.

## Remaining

Google OAuth client, `TOKEN_ENCRYPTION_KEY`, a new FLUENT Postgres database, and an optional AI key. Live Gmail and live model behavior are unverified until those exist.
