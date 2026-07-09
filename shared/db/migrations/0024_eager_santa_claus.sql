CREATE TABLE "job_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"scheduled_date" date,
	"scheduled_start" time,
	"scheduled_end" time,
	"status" text DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_visits_status_check" CHECK ("job_visits"."status" in ('pending', 'in_progress', 'complete', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "job_visits" ADD CONSTRAINT "job_visits_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_visits" ADD CONSTRAINT "job_visits_assignee_fk" FOREIGN KEY ("org_id","assignee_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_visits_org_job_idx" ON "job_visits" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX "job_visits_org_assignee_date_idx" ON "job_visits" USING btree ("org_id","assignee_user_id","scheduled_date");