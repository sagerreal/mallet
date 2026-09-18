CREATE TABLE "quoting_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"service_id" uuid,
	"job_tag" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"author_user_id" uuid,
	"source_estimate_id" uuid,
	"times_confirmed" integer DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quoting_rules_status_check" CHECK ("quoting_rules"."status" in ('proposed', 'confirmed')),
	CONSTRAINT "quoting_rules_source_check" CHECK ("quoting_rules"."source" in ('manual', 'refine', 'edit_delta'))
);
--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "ai_draft" jsonb;--> statement-breakpoint
ALTER TABLE "quoting_rules" ADD CONSTRAINT "quoting_rules_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quoting_rules" ADD CONSTRAINT "quoting_rules_service_fk" FOREIGN KEY ("org_id","service_id") REFERENCES "public"."pricebook_items"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quoting_rules" ADD CONSTRAINT "quoting_rules_estimate_fk" FOREIGN KEY ("org_id","source_estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quoting_rules_org_status_idx" ON "quoting_rules" USING btree ("org_id","status","invalidated_at");