# Local setup

## Requirements

- Node.js 22+ and pnpm 10 (`corepack enable` picks up the pinned version from `package.json`)
- PostgreSQL 14+ (local install, Docker, or a hosted database such as Supabase)
- Optional: a Google Cloud project (for real Gmail), an xAI API key (for AI features)

FLUENT boots without Google or AI credentials and shows an honest "not configured" state. It never shows fake mail.

## 1. Install

```bash
pnpm install
cp .env.example .env
```

## 2. Configure `.env`

| Variable | Required | Notes |
| --- | --- | --- |
| `APP_URL` | yes | Public origin of the web app, no trailing slash. Local dev: `http://localhost:5173`. Used for the OAuth redirect URI **and** the CSRF origin check, so the browser must use exactly this origin. |
| `DATABASE_URL` | yes | Postgres connection string. URL-encode special characters in the password (`@` → `%40`). |
| `DATABASE_SSL` | no | `auto` (default: TLS for non-localhost hosts), `require` or `disable`. |
| `TOKEN_ENCRYPTION_KEY` | yes for sign-in | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts OAuth tokens and audit subjects. Changing it invalidates stored tokens (users must sign in again). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Gmail | OAuth 2.0 "Web application" client. |
| `AI_PROVIDER` | no | `xai` (default) or `openai`. |
| `AI_MODEL` | no | Overrides the default model (`grok-4.7` for xAI, `gpt-4.1-mini` for OpenAI). |
| `XAI_API_KEY` / `OPENAI_API_KEY` | for AI | Key for the selected provider. Without it, AI features report "not configured". |
| `LOG_LEVEL` | no | `info` by default. Logs never contain email bodies, subjects, prompts or tokens. |
| `SESSION_TTL_DAYS` | no | Session lifetime, default 30. |

`FLUENT_TEST_GOOGLE_BASE` and `FLUENT_TEST_AI_BASE` exist only for the test fakes and are ignored when `NODE_ENV=production`. Never set them in a deployment.

## 3. Database

```bash
pnpm db:migrate        # applies drizzle/*.sql to DATABASE_URL (reads .env)
```

Migrations are plain SQL under `drizzle/`. `0001_lockdown.sql` enables row-level security on every table and revokes access from Supabase's `anon`/`authenticated` roles (when those roles exist), so the tables are reachable only through FLUENT's server connection. After editing `server/db/schema.ts`, run `pnpm db:generate` to create a new migration.

## 4. Google Cloud (real Gmail)

1. Create or choose a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. **APIs & Services → Library**: enable the **Gmail API**.
3. **Google Auth Platform → Branding / Audience**: set the app name, support email, app domain, and links to `/privacy` and `/terms`. While the app is in **Testing**, add each Google account that may sign in as a *test user* (up to 100).
4. **Data access (scopes)**: add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.settings.basic`.
5. **Clients → Create client → Web application**:
   - Authorized JavaScript origins: `http://localhost:5173` (and each deployed origin)
   - Authorized redirect URIs: `http://localhost:5173/api/auth/google/callback` (and `https://<your-domain>/api/auth/google/callback` for each deployment)
6. Copy the client ID and secret into `.env`.

`gmail.modify` is a **restricted** scope. In Testing mode it works for listed test users only (refresh tokens for apps in Testing expire after 7 days). Publishing to all users requires Google's OAuth app verification **and** an annual third-party security assessment (CASA). See [SECURITY.md](SECURITY.md#google-oauth-verification-and-casa).

## 5. AI

Create an API key in the [xAI console](https://console.x.ai/) and set `XAI_API_KEY`. To use OpenAI instead set `AI_PROVIDER=openai` and `OPENAI_API_KEY`.

## 6. Run

```bash
pnpm dev     # API on 127.0.0.1:8787 (tsx watch) + Vite on http://localhost:5173 (proxies /api)
```

Open <http://localhost:5173>. The landing page is at `/`; the app lives under `/app`.

## 7. Tests

```bash
pnpm typecheck && pnpm lint
pnpm test:unit                        # crypto, OAuth helpers, MIME builder (node)
pnpm vitest run --project web         # email sanitizer + iframe CSP (jsdom)
TEST_DATABASE_URL=postgres://... pnpm test:integration   # real Postgres + HTTP-level Google/Gmail/xAI fakes
pnpm e2e                              # Playwright, desktop 1440x900 + mobile 390x844
pnpm check                            # typecheck + lint + all vitest projects + build
```

- Integration tests **drop and recreate the `public` schema** of `TEST_DATABASE_URL` (default `postgres://postgres:pw@127.0.0.1:54329/fluent_test`). Point it at a throwaway database only.
- E2E (`tests/e2e/serve.ts`) builds the SPA and serves it with the real API, the HTTP fakes and a throwaway database `E2E_DATABASE_URL` (default `.../fluent_e2e`, created if missing). Set `PLAYWRIGHT_CHROME` to a Chrome binary, or run `npx playwright install chromium`. Screenshots go to `SHOTS_DIR` (default `test-results/screenshots`).
- The fakes in `tests/fakes/` (OAuth/OIDC with PKCE checks, Gmail REST, xAI Responses API) are used only by tests and never ship in the product.
