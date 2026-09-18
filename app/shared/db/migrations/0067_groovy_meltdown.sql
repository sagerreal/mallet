-- Re-mint after a migration-number collision on the shared single-writer DB. This branch's
-- labor_rates.kind (Task 1) was applied to the live DB under an earlier number; meanwhile main's
-- GBB tier migration (0066_gbb_tier_columns) merged. Both sets of DDL are ALREADY APPLIED to the
-- live DB. Regenerating against main's snapshot surfaces BOTH deltas here (main's 0066 snapshot
-- predates its own tier columns), so this migration reconciles the full state — every statement is
-- guarded to no-op on re-run. Same story/pattern as the GBB team's own 0066 re-mint.
ALTER TABLE "estimate_lines" ADD COLUMN IF NOT EXISTS "tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "recommended_tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "accepted_tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "tier_names" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "terms_snapshot" text;--> statement-breakpoint
ALTER TABLE "labor_rates" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'hourly' NOT NULL;--> statement-breakpoint
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
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labor_rates_kind_check') THEN
    ALTER TABLE "labor_rates" ADD CONSTRAINT "labor_rates_kind_check" CHECK ("labor_rates"."kind" in ('hourly', 'flat_fee'));
  END IF;
END $$;
