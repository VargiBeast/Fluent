# Deployment (Vercel)

FLUENT deploys as one Vercel project: the Vite SPA (static, `dist/`) plus one Node.js function (`api/index.ts`, a Hono app) that serves everything under `/api`.

`vercel.json` already defines:

- `installCommand` `pnpm install --frozen-lockfile`, `buildCommand` `pnpm build`, `outputDirectory` `dist`, framework `vite`
- the function `api/index.ts` (60 s max duration, 1024 MB)
- rewrites: `/api/*` → the function, everything else → `index.html` (client-side routing)
- security headers on every response: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS; immutable caching for `/assets/*`

## Environment variables

Set these per environment (Preview and/or Production) in **Project → Settings → Environment Variables**:

| Variable | Value |
| --- | --- |
| `APP_URL` | The exact origin users open, e.g. `https://fluent.example.com`. For previews use a stable alias such as the branch URL `https://fluent-git-<branch>-<team>.vercel.app`, because OAuth redirect URIs and the CSRF origin check must match it exactly. |
| `DATABASE_URL` | Hosted Postgres. For Supabase use the **Supavisor session pooler** (`postgres://postgres.<ref>:<password>@aws-…pooler.supabase.com:5432/postgres`) or the transaction pooler on port 6543; FLUENT uses `prepare: false`, so both work. URL-encode the password. |
| `DATABASE_SSL` | `require` for hosted databases. |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32`. Use different keys for preview and production. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud (see [SETUP.md](SETUP.md#4-google-cloud-real-gmail)). |
| `AI_PROVIDER`, `XAI_API_KEY` (and optional `AI_MODEL`) | AI configuration. |
| `NODE_ENV` | Set automatically to `production` by Vercel, which disables the test-only endpoint overrides. |

Do **not** set `FLUENT_TEST_GOOGLE_BASE` / `FLUENT_TEST_AI_BASE` in Vercel.

## Database migrations

Migrations are not run during the build. Run them from a trusted machine before (or right after) deploying a version that needs them:

```bash
DATABASE_URL='postgres://…' DATABASE_SSL=require pnpm db:migrate
```

They are idempotent (Drizzle tracks applied migrations in the `drizzle` schema).

## Google OAuth redirect URIs

For every origin you deploy to, add to the OAuth client:

- Authorized JavaScript origin: `https://<origin>`
- Authorized redirect URI: `https://<origin>/api/auth/google/callback`

Google does not accept wildcards, so per-deployment preview URLs (`fluent-abc123-….vercel.app`) cannot sign in; use the branch alias or a custom domain.

## Cookies on HTTPS

When `APP_URL` starts with `https://`, the session cookie is `__Host-fluent_session` (Secure, HttpOnly, SameSite=Lax, Path=/). On plain `http://localhost` it is `fluent_session` without `Secure`.

## Limits to know

- Vercel limits request bodies to 4.5 MB, so FLUENT caps outgoing attachments at 3.5 MB total per message (base64 overhead) and returns `413 attachments_too_large` beyond that.
- Gmail API quotas apply per user and per project; FLUENT batches thread metadata requests with bounded concurrency.

## Preview deployments of the `rebuild` branch

At the time of writing, preview deployments for `rebuild` exist in the Vercel project but are in state **BLOCKED** with Vercel's "team configuration" reason, meaning that the commit author (`grok-bot@users.noreply.github.com`) is not a member of the Vercel team. The project owner must either allow these commits (see the [Vercel docs](https://vercel.com/docs/deployments/troubleshoot-project-collaboration#team-configuration)) or redeploy the commit from the Vercel dashboard. A Vercel build of this branch has therefore not been verified yet.
