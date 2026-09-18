CREATE TABLE "pricebook_markup_bands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"min_cost_cents" integer NOT NULL,
	"markup_bps" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricebook_markup_bands_org_floor_uq" UNIQUE("org_id","min_cost_cents"),
	CONSTRAINT "pricebook_markup_bands_floor_ck" CHECK ("pricebook_markup_bands"."min_cost_cents" >= 0),
	CONSTRAINT "pricebook_markup_bands_bps_ck" CHECK ("pricebook_markup_bands"."markup_bps" >= 0)
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "pricebook_materials" ADD COLUMN "unit_price_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricebook_materials" ADD COLUMN "pricing_mode" text DEFAULT 'rule' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricebook_markup_bands" ADD CONSTRAINT "pricebook_markup_bands_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricebook_markup_bands_org_idx" ON "pricebook_markup_bands" USING btree ("org_id");--> statement-breakpoint
ALTER TABLE "pricebook_materials" ADD CONSTRAINT "pricebook_materials_pricing_mode_ck" CHECK ("pricebook_materials"."pricing_mode" in ('rule','manual'));