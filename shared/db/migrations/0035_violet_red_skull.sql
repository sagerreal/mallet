CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"tech_user_id" uuid NOT NULL,
	"job_id" uuid,
	"work_date" date NOT NULL,
	"kind" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time,
	"note" text DEFAULT '' NOT NULL,
	"src" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"running" boolean DEFAULT false NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "time_entries_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "time_entries_kind_check" CHECK ("time_entries"."kind" in ('job', 'travel', 'break', 'shop')),
	CONSTRAINT "time_entries_src_check" CHECK ("time_entries"."src" in ('manual', 'clock', 'timer')),
	CONSTRAINT "time_entries_status_check" CHECK ("time_entries"."status" in ('draft', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tech_user_fk" FOREIGN KEY ("org_id","tech_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_org_tech_date_idx" ON "time_entries" USING btree ("org_id","tech_user_id","work_date");--> statement-breakpoint
CREATE INDEX "time_entries_org_status_idx" ON "time_entries" USING btree ("org_id","status");