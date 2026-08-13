-- RE-RUNNABLE BY DESIGN, and this file explains why rather than leaving the next reader guessing.
--
-- These exact changes are already applied to the shared dev/prod database: they landed under 0153
-- and then 0154 on this branch while parallel branches merged their OWN 0153, 0154 and 0155 to
-- main. Each renumber changes the file's hash, so drizzle sees an unapplied migration and runs it
-- again on a database where every object already exists. Rather than hand-editing the
-- applied-migrations ledger — surgery on a production table to paper over a numbering race — every
-- statement is a no-op when its object is present. A fresh database gets exactly this schema; the
-- shared one gets nothing.
--
-- The guards are per-object rather than one DO block: a partially-applied state must converge, not
-- fail at the first collision.

CREATE TABLE IF NOT EXISTS "timesheet_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tech_user_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_submissions_org_tech_week_uq" UNIQUE("org_id","tech_user_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT IF EXISTS "time_entries_kind_check";--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "start_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "minutes" integer;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "edited_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "tech_edits_times" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "ot_weekly_threshold_minutes" integer DEFAULT 2400 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN IF NOT EXISTS "ot_daily_threshold_minutes" integer;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "timesheet_submissions" ADD CONSTRAINT "timesheet_submissions_tech_fk" FOREIGN KEY ("org_id","tech_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_kind_shape_check" CHECK (("time_entries"."kind" in ('job', 'travel', 'break', 'shop') and "time_entries"."start_time" is not null and "time_entries"."minutes" is null)
          or ("time_entries"."kind" in ('pto', 'vacation', 'sick', 'holiday') and "time_entries"."start_time" is null and "time_entries"."end_time" is null and "time_entries"."minutes" between 1 and 1440 and "time_entries"."running" = false));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_kind_check" CHECK ("time_entries"."kind" in ('job', 'travel', 'break', 'shop', 'pto', 'vacation', 'sick', 'holiday'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;