# Local setup

## Requirements

- Node.js 22+ and pnpm 10 (`corepack enable` picks up the pinned version from `package.json`)
- PostgreSQL 14+ (local install, Docker, or a hosted database such as Supabase)
- Optional: a Google Cloud project (for real Gmail), a Google AI Studio (Gemini) API key for AI features

MailIQ boots without Google or AI credentials and shows an honest "not configured" state. It never shows fake mail.

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
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | for Outlook / Microsoft 365 | Microsoft Entra app registration (see [§4b](#4b-microsoft-entra-id-outlook--microsoft-365-mailboxes)). Outlook shows "Not configured" without them. |
| `AI_PROVIDER` | no | `google`, `xai` or `openai`. If empty, the provider is picked from the keys that are set: Gemini first, then xAI, then OpenAI. |
| `AI_MODEL` | no | Overrides the default model (`gemini-3.5-flash-lite` for Gemini, `grok-4.7` for xAI, `gpt-4.1-mini` for OpenAI). |
| `GOOGLE_GENERATIVE_AI_API_KEY` / `XAI_API_KEY` / `OPENAI_API_KEY` | for AI | Key for the selected provider. Without it, AI features report "not configured". |
| `LOG_LEVEL` | no | `info` by default. Logs never contain email bodies, subjects, prompts or tokens. |
| `SESSION_TTL_DAYS` | no | Session lifetime, default 30. |

`MAILIQ_TEST_GOOGLE_BASE` and `MAILIQ_TEST_AI_BASE` exist only for the test fakes and are ignored when `NODE_ENV=production`. Never set them in a deployment.

## 3. Database

```bash
pnpm db:migrate        # applies drizzle/*.sql to DATABASE_URL (reads .env)
```

Migrations are plain SQL under `drizzle/`. `0001_lockdown.sql` enables row-level security on every table and revokes access from Supabase's `anon`/`authenticated` roles (when those roles exist), so the tables are reachable only through MailIQ's server connection. After editing `server/db/schema.ts`, run `pnpm db:generate` to create a new migration.

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

## 4b. Microsoft Entra ID (Outlook / Microsoft 365 mailboxes)

MailIQ connects Outlook.com, Hotmail, Live and Microsoft 365 work or school mailboxes through Microsoft Graph. It uses OAuth 2.0 authorization code + PKCE on the server, with the same encrypted state cookie as Google. A free app registration is enough. Until `MS_CLIENT_ID` and `MS_CLIENT_SECRET` are set, the **Add account** dialog shows Outlook as **Not configured**, and `/api/auth/microsoft/start` sends you back to the Account page.

### Redirect URIs MailIQ uses
The callback is always `<APP_URL>/api/auth/microsoft/callback` (see `microsoftRedirectUri()` in `server/env.ts`). It must match the `APP_URL` of that environment exactly: scheme, host, no trailing slash.

| Environment | APP_URL | Redirect URI to register |
|---|---|---|
| Production | `https://mailiq.example.com` | `https://mailiq.example.com/api/auth/microsoft/callback` |
| Preview | branch alias | corresponding callback |
| Local dev | `http://localhost:5173` | `http://localhost:5173/api/auth/microsoft/callback` |

### Steps
1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) with any Microsoft account.
2. **Microsoft Entra ID → App registrations → New registration**.
3. Name: `MailIQ`. Supported account types: multitenant + personal Microsoft accounts.
4. Redirect URI: Web, the production callback from the table.
5. Copy Application (client) ID → `MS_CLIENT_ID`.
6. Authentication: add preview and local redirect URIs. Leave implicit grant off. Allow public client flows = No.
7. API permissions (Microsoft Graph, delegated): offline_access, User.Read, Mail.ReadWrite, Mail.Send.
8. Certificates & secrets → new client secret → copy Value → `MS_CLIENT_SECRET`.
9. Set the env vars in Vercel (mark secret Sensitive) and locally. Redeploy.

## 5. AI

MailIQ uses Google Gemini by default (`gemini-3.5-flash-lite` through `@ai-sdk/google`). Create a key in [Google AI Studio](https://aistudio.google.com/apikey) and set `GOOGLE_GENERATIVE_AI_API_KEY`.

> **Free tier vs paid tier.** Use a paid key before real users' email goes through MailIQ.

To use xAI: `AI_PROVIDER=xai` + `XAI_API_KEY`. For OpenAI: `AI_PROVIDER=openai` + `OPENAI_API_KEY`.

## 6. Run

```bash
pnpm dev     # API on 127.0.0.1:8787 + Vite on http://localhost:5173
```

## 7. Tests

```bash
pnpm typecheck && pnpm lint
pnpm test:unit
pnpm vitest run --project web
TEST_DATABASE_URL=postgres://... pnpm test:integration
pnpm e2e
pnpm check
```

Integration tests drop and recreate the `public` schema of `TEST_DATABASE_URL` (default points at a throwaway `mailiq_test` DB). E2E builds the SPA and serves it with the real API + fakes + throwaway DB.
