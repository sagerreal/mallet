CREATE TABLE "pricebook_item_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"description" text NOT NULL,
	"unit" text,
	"qty_expr" text,
	"round_up" boolean DEFAULT false NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"markup_bps" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pricebook_item_components_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "pricebook_item_components_markup_check" CHECK ("pricebook_item_components"."markup_bps" is null or "pricebook_item_components"."markup_bps" >= 0)
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "pricebook_item_id" uuid;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "pricebook_item_components" ADD CONSTRAINT "pricebook_item_components_item_fk" FOREIGN KEY ("org_id","item_id") REFERENCES "public"."pricebook_items"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricebook_item_components_org_item_idx" ON "pricebook_item_components" USING btree ("org_id","item_id");