-- Grants for the dedicated MailIQ application role (mailiq_app).
-- The role itself is created outside the repo.

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mailiq_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mailiq_app;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mailiq_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mailiq_app;

-- RLS policy that allows the app role full access (app enforces user isolation in code)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS mailiq_app_all ON %I', r.tablename);
    EXECUTE format('CREATE POLICY mailiq_app_all ON %I FOR ALL TO mailiq_app USING (true) WITH CHECK (true)', r.tablename);
  END LOOP;
END $$;
