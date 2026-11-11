# Deployment (Vercel)

MailIQ deploys as one Vercel project: the Vite SPA (static, `dist/`) plus one Node.js function (`api/index.ts`, a Hono app) that serves everything under `/api`.

`vercel.json` already defines:

- `installCommand` `pnpm install --frozen-lockfile`, `buildCommand` `pnpm build`, `outputDirectory` `dist`, framework `vite`
- the function `api/index.ts` (60 s max duration, 1024 MB)
- rewrites: `/api/*` → the function, everything else → `index.html` (client-side routing)
- security headers on every response: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS; immutable caching for `/assets/*`

## Environment variables

Set these per environment (Preview and/or Production) in **Project → Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `APP_URL` | The exact origin users open, e.g. `https://mailiq.example.com`. For previews use a stable alias such as the branch URL `https://mailiq-git-<branch>-<team>.vercel.app`, because OAuth redirect URIs and the CSRF origin check must match it exactly. |
| `DATABASE_URL` | Hosted Postgres. For Supabase use the **Supavisor session pooler** (`postgres://postgres.<ref>:<password>@aws-…pooler.supabase.com:5432/postgres`) or the transaction pooler on port 6543; MailIQ uses `prepare: false`, so both work. URL-encode the password. |
| `DATABASE_SSL` | `require` for hosted databases. |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`. Use different keys for preview and production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud (see [SETUP.md](SETUP.md#4-google-cloud-real-gmail)). |
| `MS_CLIENT_ID`, `MS_CLIENT_SECRET` | From the Microsoft Entra app registration (see [SETUP.md](SETUP.md#4b-microsoft-entra-id-outlook--microsoft-365-mailboxes)). Mark the secret Sensitive. |
| `GOOGLE_GENERATIVE_AI_API_KEY` (or `XAI_API_KEY` / `OPENAI_API_KEY`), optional `AI_PROVIDER` and `AI_MODEL` | AI configuration. Gemini is used by default when its key is set. Use a paid Gemini key for production (see SETUP §5). |
| `NODE_ENV` | Set automatically to `production` by Vercel, which disables the test-only endpoint overrides. |

Do **not** set `MailIQ_TEST_GOOGLE_BASE` / `MailIQ_TEST_AI_BASE` in Vercel.

## Database migrations

Migrations are not run during the build. Run them from a trusted machine before (or right after) deploying a version that needs them:

```bash
DATABASE_URL='postgres://…' DATABASE_SSL=require pnpm db:migrate
```

They are idempotent.

## OAuth redirect URIs

Register these exact URIs in Google Cloud and Microsoft Entra:

- Production: `https://<your-domain>/api/auth/google/callback` and `https://<your-domain>/api/auth/microsoft/callback`
- Previews: the branch alias (or custom domain) + the same paths. Vercel preview URLs that include a deployment hash change on every commit and are not suitable for OAuth; use the branch alias or a custom domain.

## Cookies on HTTPS

When `APP_URL` starts with `https://`, the session cookie is `__Host-mailiq_session` (Secure, HttpOnly, SameSite=Lax, Path=/). On plain `http://localhost` it is `mailiq_session` without `Secure`.

## Limits to know

- Vercel limits request bodies to 4.5 MB, so MailIQ caps outgoing attachments at 3.5 MB total per message (base64 overhead) and returns `413 attachments_too_large` beyond that.
- Gmail API quotas apply per user and per project; MailIQ batches thread metadata requests with bounded concurrency.

## Preview deployments of the `rebuild` branch

Commits on `rebuild` are authored by the repository owner so Vercel builds them (earlier commits by a non-member author were **BLOCKED** by Vercel's team configuration). The branch alias is `https://mailiq-git-rebuild-vargs-projects-93e3d823.vercel.app`.

The preview uses a Supabase Postgres database:

- Migrations `0000`–`0002` are applied; every table has RLS enabled and `anon`/`authenticated` have no table privileges.
- The app connects through the Supabase transaction pooler (port 6543) as a dedicated login role, `mailiq_app`. It is not a superuser, has no `BYPASSRLS`, and has only `SELECT/INSERT/UPDATE/DELETE` on the app tables, which migration `0002_app_role.sql` grants together with a `mailiq_app_all` RLS policy. The role and its password are created outside the repo; migrations run as `postgres`.
- Preview-only variables, scoped to the `rebuild` branch: `DATABASE_URL` (sensitive), `DATABASE_SSL=require`, `TOKEN_ENCRYPTION_KEY` (sensitive), `APP_URL`. No Google or xAI variables are set yet, so sign-in and AI stay disabled on the preview.

`GET /api/health` is a liveness check with no dependencies. `GET /api/ready` runs a trivial query against `users` and returns `{"ok":true,"database":"ok"}`, or a 503 with `"not_configured"` or `"error"` (details are logged, never returned). `GET /api/ready?deep=1` also checks the external credentials:

- **`ai`:** sends a tiny synthetic prompt to the AI provider and discards the output.
- **`googleClient`:** exchanges a bogus OAuth code. Google answers `invalid_grant` when the client ID and secret are valid, and `invalid_client` when they are not.

Each check returns `ok`, `error`, `not_configured` or `invalid_client`. Deep checks are rate limited (5 per IP per 10 minutes, 30 per hour in total) and cached for 60 seconds.
