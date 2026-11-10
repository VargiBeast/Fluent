ALTER TABLE "accounts" ADD COLUMN "provider" text DEFAULT 'gmail' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "credentials_enc" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_provider_ck" CHECK ("accounts"."provider" in ('gmail', 'imap', 'outlook'));