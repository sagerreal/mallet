-- Sort indexes for the invoices list (modules/invoicing/infra/invoice-sorts.ts), plus trigram
-- indexes on the searchable text. IF NOT EXISTS because dev and prod share a database and a
-- partially-applied batch must be safe to re-run. No RLS change — policies cover rows, not indexes.
CREATE INDEX IF NOT EXISTS "invoices_org_due_idx" ON "invoices" USING btree ("org_id","due_at","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_org_total_idx" ON "invoices" USING btree ("org_id","total_cents" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_num_trgm_idx" ON "invoices" USING gin ("num" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_title_trgm_idx" ON "invoices" USING gin ("title" gin_trgm_ops);
