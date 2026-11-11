-- Lock down the database for the MailIQ app role.
-- Run as a superuser / postgres after creating the mailiq_app role.

-- Revoke default privileges from public
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mailiq_app;

-- Enable RLS on all tables (idempotent)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
