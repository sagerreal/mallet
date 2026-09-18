ALTER TABLE "estimate_lines" ADD COLUMN "scope" text;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "sub_items" jsonb;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "price_display" text DEFAULT 'lines' NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_price_display_check" CHECK ("estimates"."price_display" in ('lines', 'total'));