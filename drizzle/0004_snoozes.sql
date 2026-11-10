CREATE TABLE "snoozes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"kind" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "snoozes" ADD CONSTRAINT "snoozes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snoozes" ADD CONSTRAINT "snoozes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snoozes_thread_uq" ON "snoozes" USING btree ("account_id","thread_id");--> statement-breakpoint
CREATE INDEX "snoozes_due_idx" ON "snoozes" USING btree ("user_id","due_at");--> statement-breakpoint
-- Same lockdown as 0001-0003: RLS on, no access for Supabase API roles, DML + policy for fluent_app.
ALTER TABLE "snoozes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.snoozes FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.snoozes FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fluent_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.snoozes TO fluent_app';
    EXECUTE 'DROP POLICY IF EXISTS fluent_app_all ON public.snoozes';
    EXECUTE 'CREATE POLICY fluent_app_all ON public.snoozes AS PERMISSIVE FOR ALL TO fluent_app USING (true) WITH CHECK (true)';
  END IF;
END $$;
