CREATE INDEX "leads_org_stage_idx" ON "leads" USING btree ("org_id","stage");--> statement-breakpoint
CREATE INDEX "estimates_org_status_idx" ON "estimates" USING btree ("org_id","status");