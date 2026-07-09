ALTER TABLE "leads" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_company_fk" FOREIGN KEY ("org_id","company_id") REFERENCES "public"."companies"("org_id","id") ON DELETE no action ON UPDATE no action;