CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"text" text NOT NULL,
	"type" text DEFAULT 'check' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "checklist_items_type_check" CHECK ("checklist_items"."type" in ('check', 'photo'))
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trade" text DEFAULT 'Custom' NOT NULL,
	"stage" text DEFAULT 'job' NOT NULL,
	"match" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "checklist_templates_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "checklist_templates_stage_check" CHECK ("checklist_templates"."stage" in ('job', 'scope'))
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_fk" FOREIGN KEY ("org_id","template_id") REFERENCES "public"."checklist_templates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_items_org_template_idx" ON "checklist_items" USING btree ("org_id","template_id");--> statement-breakpoint
CREATE INDEX "checklist_templates_org_deleted_idx" ON "checklist_templates" USING btree ("org_id","deleted_at");