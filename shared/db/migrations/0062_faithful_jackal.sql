ALTER TABLE "estimate_lines" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "recommended_tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "accepted_tier" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "tier_names" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "terms_snapshot" text;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_tier_check" CHECK ("estimate_lines"."tier" in ('good', 'better', 'best'));--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_recommended_tier_check" CHECK ("estimates"."recommended_tier" in ('good', 'better', 'best'));--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_accepted_tier_check" CHECK ("estimates"."accepted_tier" in ('good', 'better', 'best'));