ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "idempotency_key" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "estimates_org_status_idx" ON "estimates" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "messages_org_idem_uidx" ON "messages" USING btree ("org_id","idempotency_key") WHERE "messages"."idempotency_key" is not null;