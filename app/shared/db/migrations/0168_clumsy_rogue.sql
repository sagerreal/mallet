CREATE TABLE "pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pipeline_stages_org_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "pipeline_stage_id" uuid;--> statement-breakpoint
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_stages_org_deleted_idx" ON "pipeline_stages" USING btree ("org_id","deleted_at");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_pipeline_stage_fk" FOREIGN KEY ("org_id","pipeline_stage_id") REFERENCES "public"."pipeline_stages"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_org_pipeline_stage_idx" ON "leads" USING btree ("org_id","pipeline_stage_id");