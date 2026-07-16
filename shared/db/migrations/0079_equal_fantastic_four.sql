ALTER TABLE "jobs" ADD COLUMN "callback_of" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "callback_reason" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_callback_of_fk" FOREIGN KEY ("org_id","callback_of") REFERENCES "public"."jobs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_callback_reason_check" CHECK ("jobs"."callback_reason" is null or "jobs"."callback_reason" in ('callback', 'new_issue', 'found_work'));