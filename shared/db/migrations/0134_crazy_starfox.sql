ALTER TABLE "estimates" ADD COLUMN "job_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "po_number" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "public_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_public_token_uidx" ON "invoices" USING btree ("public_token") WHERE "invoices"."public_token" is not null;--> statement-breakpoint
-- Hand-written: drizzle-kit cannot emit this FK from estimates.ts because importing `jobs` there
-- would create a circular import with jobs.ts (which already imports estimates.ts), breaking
-- `tsc --noEmit`. The column is declared in the schema; this constraint is declared here only.
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE no action ON UPDATE no action;