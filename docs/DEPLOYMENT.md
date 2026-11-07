# Deployment

No FLUENT Vercel project is connected. Do not deploy this branch to a public production or preview URL, and do not reuse another project's Vercel settings.

`vercel.json` is the intended shape once a new project exists:

- Install with pnpm.
- Build the Express bundle and the Vite client.
- Static output: `artifacts/mail/dist/public`.
- SPA fallback for non-API paths.
- `/api/*` stays on `api/[...path].ts`, which exports the same Express app.
- Security headers are set at the edge. The API also sets them.

Suggested project settings, after the project is created:

- Root directory: repository root.
- Production branch: `main`, only after review and a private smoke test.
- Preview deployments: off until secrets and a private audience are ready.
- Environment variables: the names in `docs/ENVIRONMENT.md`, different values for preview and production.
- Do not mark demo mode on in production.

Health: `GET /api/healthz` returns `status: ok` plus boolean or enum checks. It does not include secret values. A healthy process can still report `db: unconfigured` or `googleLogin: blocked`.

Before any hosted deploy:

1. Create the FLUENT Supabase project and run the migration.
2. Create the Google OAuth client and set the redirect URIs.
3. Generate `TOKEN_ENCRYPTION_KEY`.
4. Decide whether AI is blocked, mock, or live.
5. Run typecheck, tests, and both production builds.
6. Smoke-test on a private URL. Do not call it production-ready until that runtime check exists.
