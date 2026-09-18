ALTER TABLE "jobs" ADD COLUMN "tax_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tax_bps_check" CHECK ("jobs"."tax_bps" >= 0);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tax_cents_check" CHECK ("jobs"."tax_cents" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_bps_check" CHECK ("invoices"."tax_bps" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tax_cents_check" CHECK ("invoices"."tax_cents" >= 0 and "invoices"."tax_cents" <= "invoices"."total_cents");