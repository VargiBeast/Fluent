# Supabase setup

FLUENT does not have a Supabase project yet. Do not attach an existing project from another application.

When you create a new FLUENT project:

1. Create an empty Supabase project in the account that should own FLUENT.
2. Copy its Postgres connection string into `DATABASE_URL` for the API only. Do not put the service-role key in the browser.
3. Apply the reviewed migration. It does not run automatically:

```bash
export DATABASE_URL='postgresql://...'
pnpm --filter @workspace/db run migrate
```

4. Confirm the role `fluent_app` exists and is not a superuser. The API runs `SET LOCAL ROLE fluent_app` and `set_config('app.user_id', ...)` on each product transaction.
5. Confirm row-level security is enabled and forced on the mailbox tables. `oauth_states` and `schema_migrations` have no policies for `fluent_app`.
6. Use the restricted role for the application connection if the provider lets you. On Supabase the default `postgres` user can bypass RLS, which is why the app switches role inside the transaction. Do not use the service role from the Vite app.

The migration file is `lib/db/migrations/0001_init.sql`. Retention: the sync stores one page of metadata plus sanitized bodies that the user opens, not a full mailbox export. Local drafts stay until a later retention job. Audit rows store action names and ids, not message bodies.

This repository has not applied the migration to any hosted database.
