-- GBB tier columns (re-mint of the branch's 0062 after a migration-number collision
-- with main's pricebook 0062-0065 — same single-writer story as 0060/0061).
-- The DDL is ALREADY APPLIED to the live DB under the old number, so every
-- statement is guarded to no-op on re-run.
ALTER TABLE "estimate_lines" ADD COLUMN IF NOT EXISTS "tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "recommended_tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "accepted_tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "tier_names" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "terms_snapshot" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimate_lines_tier_check') THEN
    ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_tier_check" CHECK ("estimate_lines"."tier" in ('good', 'better', 'best'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimates_recommended_tier_check') THEN
    ALTER TABLE "estimates" ADD CONSTRAINT "estimates_recommended_tier_check" CHECK ("estimates"."recommended_tier" in ('good', 'better', 'best'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimates_accepted_tier_check') THEN
    ALTER TABLE "estimates" ADD CONSTRAINT "estimates_accepted_tier_check" CHECK ("estimates"."accepted_tier" in ('good', 'better', 'best'));
  END IF;
END $$;