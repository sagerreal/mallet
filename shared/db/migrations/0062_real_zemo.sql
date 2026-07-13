CREATE TABLE "pricebook_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pricebook_categories_org_id_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "labor_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "taxable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "warranty_text" text;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "is_addon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pricebook_categories" ADD CONSTRAINT "pricebook_categories_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_categories" ADD CONSTRAINT "pricebook_categories_parent_fk" FOREIGN KEY ("org_id","parent_id") REFERENCES "public"."pricebook_categories"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricebook_categories_org_deleted_idx" ON "pricebook_categories" USING btree ("org_id","deleted_at");--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_category_fk" FOREIGN KEY ("org_id","category_id") REFERENCES "public"."pricebook_categories"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricebook_items_org_category_idx" ON "pricebook_items" USING btree ("org_id","category_id");--> statement-breakpoint
CREATE INDEX "pricebook_items_org_name_idx" ON "pricebook_items" USING btree ("org_id","label");