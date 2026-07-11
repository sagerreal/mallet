CREATE TABLE "job_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT 1 NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"invoice_skip" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_addons_qty_check" CHECK ("job_addons"."quantity" >= 0),
	CONSTRAINT "job_addons_rate_check" CHECK ("job_addons"."rate_cents" >= 0),
	CONSTRAINT "job_addons_cost_check" CHECK ("job_addons"."cost_cents" >= 0),
	CONSTRAINT "job_addons_status_check" CHECK ("job_addons"."status" in ('proposed', 'approved', 'declined'))
);
--> statement-breakpoint
CREATE TABLE "job_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) DEFAULT 1 NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_lines_qty_check" CHECK ("job_lines"."quantity" >= 0),
	CONSTRAINT "job_lines_rate_check" CHECK ("job_lines"."rate_cents" >= 0),
	CONSTRAINT "job_lines_cost_check" CHECK ("job_lines"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"caption" text,
	"verify_pass" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_photos_org_path_uq" UNIQUE("org_id","storage_path")
);
--> statement-breakpoint
CREATE TABLE "job_verify_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"item_id" integer NOT NULL,
	"state" text NOT NULL,
	"via" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_verify_answers_item_uq" UNIQUE("org_id","job_id","item_id"),
	CONSTRAINT "job_verify_answers_state_check" CHECK ("job_verify_answers"."state" in ('pass', 'override'))
);
--> statement-breakpoint
ALTER TABLE "job_addons" ADD CONSTRAINT "job_addons_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_lines" ADD CONSTRAINT "job_lines_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_verify_answers" ADD CONSTRAINT "job_verify_answers_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_addons_org_job_idx" ON "job_addons" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX "job_lines_org_job_idx" ON "job_lines" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX "job_photos_org_job_idx" ON "job_photos" USING btree ("org_id","job_id");--> statement-breakpoint
CREATE INDEX "job_verify_answers_org_job_idx" ON "job_verify_answers" USING btree ("org_id","job_id");