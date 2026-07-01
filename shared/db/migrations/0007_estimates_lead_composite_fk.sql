-- Reordered from the generated output: the composite unique target on leads MUST exist before
-- the estimates FK can reference it.
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "estimates" DROP CONSTRAINT "estimates_lead_id_leads_id_fk";--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE cascade ON UPDATE no action;
