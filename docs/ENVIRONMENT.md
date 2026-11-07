# Environment

Copy `.env.example` to `.env` locally. Never commit values. Names below are the complete set the app reads.

| Name | Required for | Notes |
| --- | --- | --- |
| `APP_ORIGIN` | Browser origin | Example for local Vite: `http://localhost:20126`. No path. |
| `PORT` | API and Vite process | API artifact uses `8080`. Mail artifact uses `20126`. |
| `BASE_PATH` | Vite | `/` for local mail. |
| `DATABASE_URL` | Production Postgres | A new FLUENT database. Not another app's database. |
| `TOKEN_ENCRYPTION_KEY` | OAuth token storage | 32 bytes, base64 or 64 hex characters. |
| `GOOGLE_CLIENT_ID` | Google login and Gmail connect | From a FLUENT Google Cloud OAuth client. |
| `GOOGLE_CLIENT_SECRET` | Token exchange | Server only. |
| `AI_API_KEY` | Live model | Server only. Omit it to keep AI blocked. |
| `AI_BASE_URL` | Live model | Optional. Defaults to `https://api.openai.com/v1`. |
| `AI_MODEL` | Live model | Optional. Defaults to `gpt-4o-mini`. |
| `AI_PROVIDER` | AI mode | `mock`, `live`, or unset. Unset plus no key is blocked. |
| `FLUENT_DEMO_MODE` | Synthetic mailbox | `true` only outside production. |
| `FLUENT_DB` | Local engine | `pglite` for demo/tests without Postgres. |
| `FLUENT_RATE_LIMIT_MAX` | Tests | Optional override of the per-minute API limit. |
| `LOG_LEVEL` | Logs | Optional. Defaults to `info`. |
| `NODE_ENV` | Runtime | `production` disables demo mode and sets secure cookies. |

## Local demo, no Google and no database

```bash
export FLUENT_DEMO_MODE=true
export FLUENT_DB=pglite
export AI_PROVIDER=mock
export PORT=8080
pnpm --filter @workspace/api-server run dev
```

In another shell, with `PORT=20126` and `BASE_PATH=/`:

```bash
pnpm --filter @workspace/mail run dev
```

Open the Vite origin. Choose **Enter labeled demo**. The banner states that the mailbox is synthetic.

## Checks

```bash
pnpm run typecheck
pnpm run test
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/mail run build
```
