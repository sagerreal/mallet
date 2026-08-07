ALTER TABLE "job_addons" ADD COLUMN "approved_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "job_addons" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_addons" ADD COLUMN "approval_estimate_id" uuid;--> statement-breakpoint
ALTER TABLE "job_addons" ADD CONSTRAINT "job_addons_approval_estimate_fk" FOREIGN KEY ("org_id","approval_estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE no action ON UPDATE no action;