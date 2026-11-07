-- Reviewed FLUENT schema. Apply with `pnpm --filter @workspace/db run migrate`.
-- Do not use drizzle-kit push. Role creation is performed by the migrate runner
-- as its own statement because PostgreSQL rejects CREATE ROLE inside a transaction.

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  google_sub text unique,
  display_name text,
  avatar_url text,
  is_demo boolean not null default false,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  csrf_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

create table if not exists oauth_states (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('login', 'gmail')),
  state_hash text not null unique,
  verifier_ciphertext text not null,
  user_id uuid references profiles(id) on delete cascade,
  return_to text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  email text,
  scopes text[] not null,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  encryption_key_version integer not null default 1,
  status text not null check (status in ('active', 'reauth_required', 'disconnected')),
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists connected_accounts_user_provider_idx
  on connected_accounts (user_id, provider);

create table if not exists email_sync_state (
  user_id uuid primary key references profiles(id) on delete cascade,
  source text not null check (source in ('gmail', 'demo')),
  history_id text,
  last_sync_at timestamptz,
  status text not null default 'idle',
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists email_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null check (source in ('gmail', 'demo')),
  external_id text not null,
  subject text not null default '',
  snippet text not null default '',
  last_message_at timestamptz not null,
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  is_important boolean not null default false,
  needs_reply boolean not null default false,
  labels text[] not null default '{}',
  category text,
  message_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists email_threads_user_recent_idx
  on email_threads (user_id, last_message_at desc);

create table if not exists emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  thread_id uuid not null references email_threads(id) on delete cascade,
  external_id text not null,
  from_name text,
  from_email text not null,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  subject text not null default '',
  snippet text not null default '',
  body_text text not null default '',
  body_html_sanitized text not null default '',
  internal_date timestamptz not null,
  is_unread boolean not null default false,
  is_starred boolean not null default false,
  has_attachments boolean not null default false,
  labels text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, external_id)
);
create index if not exists emails_thread_idx on emails (user_id, thread_id, internal_date);

create table if not exists email_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  email_id uuid not null references emails(id) on delete cascade,
  filename text not null,
  mime_type text,
  size_bytes integer,
  external_id text,
  created_at timestamptz not null default now()
);
create index if not exists email_attachments_email_idx on email_attachments (email_id);

create table if not exists local_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  thread_id uuid references email_threads(id) on delete cascade,
  kind text not null check (kind in ('reply', 'compose')),
  to_email text not null default '',
  subject text not null default '',
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists local_drafts_user_idx on local_drafts (user_id, updated_at desc);

create table if not exists ai_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  thread_id uuid not null references email_threads(id) on delete cascade,
  mock boolean not null,
  model text not null,
  content jsonb not null,
  source_message_ids text[] not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_summaries_thread_idx on ai_summaries (user_id, thread_id, created_at desc);

create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('overview')),
  mock boolean not null,
  model text not null,
  content jsonb not null,
  source_thread_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists ai_insights_user_idx on ai_insights (user_id, created_at desc);

create table if not exists user_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  load_remote_images boolean not null default false,
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

create table if not exists action_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  thread_id uuid not null references email_threads(id) on delete cascade,
  action text not null check (action in ('archive', 'trash')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists action_approvals_user_idx on action_approvals (user_id, created_at desc);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  action text not null,
  target_id text,
  result text not null,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_user_idx on audit_events (user_id, created_at desc);

-- Owner and superuser bypass RLS unless it is forced. The API sets the
-- transaction role to fluent_app, which is not a superuser and does not bypass RLS.
alter table profiles enable row level security;
alter table profiles force row level security;
alter table sessions enable row level security;
alter table sessions force row level security;
alter table oauth_states enable row level security;
alter table oauth_states force row level security;
alter table connected_accounts enable row level security;
alter table connected_accounts force row level security;
alter table email_sync_state enable row level security;
alter table email_sync_state force row level security;
alter table email_threads enable row level security;
alter table email_threads force row level security;
alter table emails enable row level security;
alter table emails force row level security;
alter table email_attachments enable row level security;
alter table email_attachments force row level security;
alter table local_drafts enable row level security;
alter table local_drafts force row level security;
alter table ai_summaries enable row level security;
alter table ai_summaries force row level security;
alter table ai_insights enable row level security;
alter table ai_insights force row level security;
alter table user_preferences enable row level security;
alter table user_preferences force row level security;
alter table action_approvals enable row level security;
alter table action_approvals force row level security;
alter table audit_events enable row level security;
alter table audit_events force row level security;
alter table schema_migrations enable row level security;
alter table schema_migrations force row level security;

drop policy if exists profiles_self on profiles;
create policy profiles_self on profiles
  using (id = current_setting('app.user_id', true)::uuid)
  with check (id = current_setting('app.user_id', true)::uuid);

drop policy if exists sessions_self on sessions;
create policy sessions_self on sessions
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists connected_accounts_self on connected_accounts;
create policy connected_accounts_self on connected_accounts
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists email_sync_state_self on email_sync_state;
create policy email_sync_state_self on email_sync_state
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists email_threads_self on email_threads;
create policy email_threads_self on email_threads
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists emails_self on emails;
create policy emails_self on emails
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists email_attachments_self on email_attachments;
create policy email_attachments_self on email_attachments
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists local_drafts_self on local_drafts;
create policy local_drafts_self on local_drafts
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists ai_summaries_self on ai_summaries;
create policy ai_summaries_self on ai_summaries
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists ai_insights_self on ai_insights;
create policy ai_insights_self on ai_insights
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists user_preferences_self on user_preferences;
create policy user_preferences_self on user_preferences
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists action_approvals_self on action_approvals;
create policy action_approvals_self on action_approvals
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

drop policy if exists audit_events_self on audit_events;
create policy audit_events_self on audit_events
  using (user_id = current_setting('app.user_id', true)::uuid)
  with check (user_id = current_setting('app.user_id', true)::uuid);

-- oauth_states and schema_migrations have no policies: fluent_app cannot read them.
-- Session lookup and OAuth state consume run as the table owner through reviewed functions.

revoke all on schema_migrations, oauth_states from fluent_app;
grant usage on schema public to fluent_app;
grant select, insert, update, delete on
  profiles,
  sessions,
  connected_accounts,
  email_sync_state,
  email_threads,
  emails,
  email_attachments,
  local_drafts,
  ai_summaries,
  ai_insights,
  user_preferences,
  action_approvals,
  audit_events
to fluent_app;
