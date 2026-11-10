CREATE TABLE "daily_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"scope" text NOT NULL,
	"policy_key" text NOT NULL,
	"payload_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "daily_briefs" ADD CONSTRAINT "daily_briefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_briefs_uq" ON "daily_briefs" USING btree ("user_id","day","scope");--> statement-breakpoint
-- Same lockdown as 0001-0007: RLS on, no access for Supabase API roles, DML + policy for fluent_app.
ALTER TABLE "daily_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.daily_briefs FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.daily_briefs FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fluent_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_briefs TO fluent_app';
    EXECUTE 'DROP POLICY IF EXISTS fluent_app_all ON public.daily_briefs';
    EXECUTE 'CREATE POLICY fluent_app_all ON public.daily_briefs AS PERMISSIVE FOR ALL TO fluent_app USING (true) WITH CHECK (true)';
  END IF;
END $$;
