CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"num" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"source_estimate_id" uuid,
	"assignee_user_id" uuid,
	"title" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "jobs_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('scheduled', 'in_progress', 'complete', 'canceled')),
	CONSTRAINT "jobs_total_check" CHECK ("jobs"."total_cents" >= 0),
	CONSTRAINT "jobs_window_check" CHECK ("jobs"."scheduled_end" is null or "jobs"."scheduled_start" is null or "jobs"."scheduled_end" >= "jobs"."scheduled_start")
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_estimate_fk" FOREIGN KEY ("org_id","source_estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assignee_fk" FOREIGN KEY ("org_id","assignee_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_org_created_idx" ON "jobs" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "jobs_org_lead_idx" ON "jobs" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE INDEX "jobs_org_assignee_idx" ON "jobs" USING btree ("org_id","assignee_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_org_num_uidx" ON "jobs" USING btree ("org_id","num") WHERE "jobs"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_org_source_estimate_uidx" ON "jobs" USING btree ("org_id","source_estimate_id") WHERE "jobs"."source_estimate_id" is not null and "jobs"."deleted_at" is null;