ALTER TABLE "pricebook_items" ALTER COLUMN "taxable" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "pricebook_materials" ALTER COLUMN "taxable" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "disc_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "disc_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_lines" ADD COLUMN "taxable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "tax_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_disc_bps_check" CHECK ("jobs"."disc_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_disc_bps_check" CHECK ("invoices"."disc_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_discount_cents_check" CHECK ("invoices"."discount_cents" >= 0);--> statement-breakpoint
--
-- Backfill the pricebook to match the flipped default (hand-written; drizzle-kit only emits the
-- SET DEFAULT, which reaches new rows and no existing ones).
--
-- WHY THIS IS SAFE, AND WHY LEAVING IT OUT WOULD NOT BE. `taxable` shipped as `false` with no UI
-- reading it and no totals code consuming it, so `false` on these rows is a schema default and not
-- a shop's answer. Live proof: of 100 pricebook_items rows exactly 2 are true, and both belong to
-- integration-test orgs ("PricebookApi A …", "PricebookImportApi A …") — every real shop's book is
-- 100% false. pricebook_materials has no rows at all. Leaving them false would mean a shop sets its
-- rate in Settings, quotes a job, and still bills $0.00 tax with nothing on screen explaining why.
--
-- No existing document changes: pricebook taxability seeds NEW estimate lines only. It is never
-- read back onto a quote, job or invoice that already exists.
UPDATE "pricebook_items" SET "taxable" = true WHERE "taxable" = false;--> statement-breakpoint
UPDATE "pricebook_materials" SET "taxable" = true WHERE "taxable" = false;