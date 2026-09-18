ALTER TABLE "invoices" ADD COLUMN "scope_job_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_scope_job_fk" FOREIGN KEY ("org_id","scope_job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_org_scope_job_idx" ON "invoices" USING btree ("org_id","scope_job_id");