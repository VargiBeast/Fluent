CREATE TABLE "copilot_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"kind" text DEFAULT 'plan' NOT NULL,
	"data_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "copilot_plans" ADD CONSTRAINT "copilot_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_plans" ADD CONSTRAINT "copilot_plans_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "copilot_plans_user_idx" ON "copilot_plans" USING btree ("user_id","created_at");--> statement-breakpoint
-- Same lockdown as 0001/0002: RLS on, no access for Supabase API roles, DML + policy for fluent_app.
ALTER TABLE "copilot_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.copilot_plans FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.copilot_plans FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fluent_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.copilot_plans TO fluent_app';
    EXECUTE 'DROP POLICY IF EXISTS fluent_app_all ON public.copilot_plans';
    EXECUTE 'CREATE POLICY fluent_app_all ON public.copilot_plans AS PERMISSIVE FOR ALL TO fluent_app USING (true) WITH CHECK (true)';
  END IF;
END $$;
