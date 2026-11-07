# FLUENT architecture

FLUENT keeps the existing pnpm workspace:

- `artifacts/mail` is the React/Vite interface.
- `artifacts/api-server` is the only HTTP API, an Express 5 app.
- `lib/db` is the Drizzle schema and reviewed SQL migrations.
- `lib/api-spec/openapi.yaml` documents that API. There is no second API.

## Vercel shape

Express stays. It is not rewritten as a parallel set of route handlers.

- `artifacts/api-server/src/app.ts` is the application.
- `artifacts/api-server/src/index.ts` listens only when it is the process entry and `VERCEL` is unset.
- `api/[...path].ts` re-exports the same app for Vercel's Node function.
- `vercel.json` builds the API and the Vite client, serves the client as static files, and leaves `/api/*` to the function.
- The Vite dev server proxies `/api` to `127.0.0.1:8080`.

Do not deploy this until a dedicated FLUENT Vercel project exists. No public production or preview deployment is part of this branch.

## Data

Production uses `DATABASE_URL` and Postgres (intended: a new FLUENT Supabase project). The app sets the transaction role to `fluent_app` and `app.user_id` from the verified session. Tables use forced row-level security.

Local demo and tests use embedded PGlite when `FLUENT_DB=pglite` or when `FLUENT_DEMO_MODE=true` outside production and `DATABASE_URL` is unset. PGlite is not a production database. Production without `DATABASE_URL` reports the database as unconfigured.

`drizzle-kit push` is disabled. Apply `lib/db/migrations/*.sql` with `pnpm --filter @workspace/db run migrate`.

## Identity and Gmail

Google sign-in uses `openid email profile` and then discards the Google access token. The browser receives an httpOnly session cookie and a CSRF token.

Gmail connect is a second OAuth consent. It requests `https://www.googleapis.com/auth/gmail.modify`. Google's description of that scope includes read, compose, and send. It does not include permanent deletion. FLUENT still has no send route, no Gmail draft writes, and trash uses `threads.trash`.

Refresh tokens are encrypted with AES-256-GCM before they are stored. They are never sent to the browser.

## AI

`AI_PROVIDER=mock` uses an extractive adapter and marks every result `mock: true`. A configured `AI_API_KEY` uses an OpenAI-compatible chat call with JSON output, no tools, and a size cap. Email text is wrapped as untrusted data. Archive and trash are not tools. They require a one-time server approval bound to the signed-in user and the conversation.

## Demo data

`FLUENT_DEMO_MODE=true` is ignored when `NODE_ENV=production`. The demo account is `demo@fluent.invalid`. Every synthetic message says it is synthetic. It is not presented as Gmail.
