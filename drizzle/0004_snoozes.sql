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
CREATE INDEX "snoozes_due_idx" ON "snoozes" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snoozes_thread_uq" ON "snoozes" USING btree ("user_id","account_id","thread_id","kind");--> statement-breakpoint
ALTER TABLE "snoozes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.snoozes FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.snoozes FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mailiq_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.snoozes TO mailiq_app';
    EXECUTE 'DROP POLICY IF EXISTS mailiq_app_all ON public.snoozes';
    EXECUTE 'CREATE POLICY mailiq_app_all ON public.snoozes AS PERMISSIVE FOR ALL TO mailiq_app USING (true) WITH CHECK (true)';
  END IF;
END $$;
