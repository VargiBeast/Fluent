CREATE TABLE "thread_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"body_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_notes" ADD CONSTRAINT "thread_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_notes" ADD CONSTRAINT "thread_notes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "thread_notes_uq" ON "thread_notes" USING btree ("user_id","account_id","thread_id");--> statement-breakpoint
CREATE INDEX "thread_notes_user_idx" ON "thread_notes" USING btree ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "thread_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.thread_notes FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.thread_notes FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mailiq_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.thread_notes TO mailiq_app';
    EXECUTE 'DROP POLICY IF EXISTS mailiq_app_all ON public.thread_notes';
    EXECUTE 'CREATE POLICY mailiq_app_all ON public.thread_notes AS PERMISSIVE FOR ALL TO mailiq_app USING (true) WITH CHECK (true)';
  END IF;
END $$;
