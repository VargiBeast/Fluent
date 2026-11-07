# Deployment

No FLUENT Vercel project is connected. Do not deploy this branch, including preview deployments, and do not link the repository to a Vercel project from this workspace.

The proposed shape is Vercel Services, checked against the public docs on 2026-11-07:

- https://vercel.com/docs/services
- https://vercel.com/docs/services/routing
- JSON Schema `https://openapi.vercel.sh/vercel.json`

Services are in beta. The names, public routes, and the decision to omit bindings still need owner confirmation. This file describes the proposal. It is not a completed production deploy.

## Proposed services

| Name | Root | Public | Why |
|---|---|---|---|
| `api-server` | `artifacts/api-server` | `/api/(.*)` | Express already mounts every route under `/api`. The service receives that original path. |
| `mail` | `artifacts/mail` | `/(.*)` after `/api` | The browser calls `/api/...` on the same origin. It does not call an internal service URL. |
| `mockup-sandbox` | `artifacts/mockup-sandbox` | none | Component preview only. No application code calls it. It stays internal so it is not a public route. |

There are no `bindings`. A binding is for a service function calling another service. The mail UI uses relative `/api` fetches in the browser. The API does not call the mail app or the mockup sandbox. Putting a binding URL in the Vite bundle would publish an internal address to every visitor, so none was added.

## Routing

Top-level rewrites, most specific first:

1. `/api/(.*)` to service `api-server`
2. `/(.*)` to service `mail`

Official routing says the service receives the original path. `GET /api/healthz` arrives at Express as `/api/healthz`, which matches `app.use("/api", router)`. The prefix is not stripped.

A request routed into a service does not continue to later top-level rewrites. The mail service therefore has its own rewrite of `/(.*)` to `/index.html` for the SPA. Vercel checks files before rewrites, so built assets are served as files.

`mockup-sandbox` has no top-level rewrite, so it receives no public traffic.

The old root file `api/[...path].ts` was removed. A root function would match `/api` in the filesystem before a rewrite, and would hide the `api-server` service.

Security headers stay at the top level because they apply to the whole public deployment.

Build and runtime fields that the services docs disallow at the top level (`framework`, `installCommand`, `buildCommand`, `outputDirectory`) live on each service. Install and build use `pnpm --dir ../..` so the pnpm workspace root is the monorepo, not the service directory.

`PORT` and `BASE_PATH` are optional for the Vite configs. When unset they are `4173` and `/`. Replit still sets both. The mail production base is `/`, which matches the public catch-all.

## Local `vercel dev`

The public docs say `vercel dev -L` runs services without a cloud login. Vercel CLI 65.12.1 help names that option `--local` and does not print `-L`. This workspace ran:

`npx --yes vercel@65.12.1 dev --local --listen 127.0.0.1:3921 --yes`

The CLI printed that it was running without a project setup and did not pull environment variables. It created a gitignored `.vercel` cache. It did not create or link a Vercel project.

It detected `api-server` (Express), `mail` (Vite), and `mockup-sandbox` (Vite).

Observed on that local server:

- `GET /api/healthz` returned 200 and the Express JSON. The API log recorded the URL as `/api/healthz`, so the `/api` prefix was preserved. The response included the top-level `nosniff`, `no-referrer`, `DENY`, and Permissions-Policy headers.
- `GET /` and `GET /login` returned 200 HTML with `<title>FLUENT</title>`, the mail app.
- `GET /__mockup` returned that same mail HTML. The mockup service was running, and no public rewrite sent traffic to it.

This was the Vite development server, not the production static build. It does not prove that a deployed mail service serves `dist/public` assets before the `/(.*)` to `/index.html` rewrite. The mail HTML response in this local session did not include the top-level security headers. Those headers are still declared for the deployment. Their production application to the mail service was not observed here.

No `vercel deploy`, preview, project create, or project link was run.

## Health

`GET /api/healthz` returns `status` plus setup enums. It does not include secret values. A healthy process can still report the database, Google, or AI as unconfigured.

Do not treat this configuration as production ready. No project was created and no deployment was started.
