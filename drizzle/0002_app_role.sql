-- Optional least-privilege runtime role. When a "fluent_app" login role exists (created out of band
-- with its own password, never in this repo), give it DML on the app tables plus an RLS policy so it
-- can use them, while anon/authenticated stay locked out by 0001. No-op when the role is absent.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fluent_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO fluent_app';
    FOREACH t IN ARRAY ARRAY['users','accounts','sessions','user_settings','ai_audit','security_events','rate_limits'] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO fluent_app', t);
      EXECUTE format('DROP POLICY IF EXISTS fluent_app_all ON public.%I', t);
      EXECUTE format('CREATE POLICY fluent_app_all ON public.%I AS PERMISSIVE FOR ALL TO fluent_app USING (true) WITH CHECK (true)', t);
    END LOOP;
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fluent_app';
  END IF;
END $$;
