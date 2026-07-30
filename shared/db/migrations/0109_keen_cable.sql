-- On-glass signature columns for jobs: the customer signing a price on the tech's device.
-- Mirrors the columns already on `estimates` so one renderer serves both paths.
--
-- IF NOT EXISTS on every statement. Dev and prod are the SAME database and migrations here are
-- single-writer; a parallel session that applied an overlapping DDL by hand would otherwise abort
-- this whole batch and leave the journal claiming it ran.
--
-- No RLS statement needed: `jobs` already has ENABLE + FORCE ROW LEVEL SECURITY with a
-- FOR ALL USING/WITH CHECK (org_id = current_org_id()) policy, and a policy covers the ROW, not a
-- column list — new columns inherit it. A fresh POLICY here would be a no-op at best and a second,
-- drifting definition at worst.
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signer_name" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signature_svg" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signer_ip" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signer_user_agent" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signed_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "signed_by_user_id" uuid;
