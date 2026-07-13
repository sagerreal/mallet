CREATE TABLE "pricebook_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"category_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"unit_of_measure" text DEFAULT 'each' NOT NULL,
	"markup_bps" integer,
	"taxable" boolean DEFAULT false NOT NULL,
	"vendor" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pricebook_materials_org_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "pricebook_service_materials" (
	"org_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(8, 2) DEFAULT '1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricebook_service_materials_service_id_material_id_pk" PRIMARY KEY("service_id","material_id")
);
--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_org_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "pricebook_materials" ADD CONSTRAINT "pricebook_materials_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_materials" ADD CONSTRAINT "pricebook_materials_category_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."pricebook_categories"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_service_materials" ADD CONSTRAINT "pricebook_service_materials_service_fk" FOREIGN KEY ("org_id","service_id") REFERENCES "public"."pricebook_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_service_materials" ADD CONSTRAINT "pricebook_service_materials_material_fk" FOREIGN KEY ("org_id","material_id") REFERENCES "public"."pricebook_materials"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricebook_materials_org_deleted_idx" ON "pricebook_materials" USING btree ("org_id","deleted_at");--> statement-breakpoint
CREATE INDEX "pricebook_materials_org_name_idx" ON "pricebook_materials" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "pricebook_service_materials_org_service_idx" ON "pricebook_service_materials" USING btree ("org_id","service_id");
