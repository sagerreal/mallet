ALTER TABLE "org_settings" ADD COLUMN "hours_mon_open" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_mon_close" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_tue_open" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_tue_close" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_wed_open" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_wed_close" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_thu_open" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_thu_close" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_fri_open" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "hours_fri_close" integer DEFAULT 17 NOT NULL;--> statement-breakpoint
-- Backfill: every org keeps EXACTLY the hours it already had. Without this the new columns would
-- silently reset a shop that opens at 7 to the 8am default, and its front desk would start turning
-- away real 7am bookings with no error anywhere.
UPDATE "org_settings" SET
  "hours_mon_open" = "hours_wd_open", "hours_mon_close" = "hours_wd_close",
  "hours_tue_open" = "hours_wd_open", "hours_tue_close" = "hours_wd_close",
  "hours_wed_open" = "hours_wd_open", "hours_wed_close" = "hours_wd_close",
  "hours_thu_open" = "hours_wd_open", "hours_thu_close" = "hours_wd_close",
  "hours_fri_open" = "hours_wd_open", "hours_fri_close" = "hours_wd_close";
