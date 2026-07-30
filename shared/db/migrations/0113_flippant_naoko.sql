-- Sort indexes for the customers list (modules/customers/infra/lead-sorts.ts), plus trigram
-- indexes for the searchable text columns.
--
-- IF NOT EXISTS throughout: dev and prod share a database and migrations are single-writer, so a
-- partially-applied batch must be safe to re-run rather than abort.
--
-- No RLS changes — policies apply to rows, not indexes.
CREATE INDEX IF NOT EXISTS "leads_org_updated_idx" ON "leads" USING btree ("org_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_name_idx" ON "leads" USING btree ("org_id","name","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_value_idx" ON "leads" USING btree ("org_id","value_cents" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- Search. ILIKE '%term%' cannot use a btree index at all, so without trigram every keystroke is
-- a sequential scan over the whole customer book. leads.name already has one from 0112.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_email_trgm_idx" ON "leads" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_phone_trgm_idx" ON "leads" USING gin ("phone_e164" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_address_trgm_idx" ON "leads" USING gin ("address" gin_trgm_ops);
