CREATE TABLE "assemblies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"catalog_key" text,
	"name" text NOT NULL,
	"measurement_basis" text NOT NULL,
	"pricing_mode" text NOT NULL,
	"margin_bps" integer DEFAULT 0 NOT NULL,
	"job_minimum_cents" integer DEFAULT 0 NOT NULL,
	"config" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "assemblies_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "assemblies_org_catalog_key_uq" UNIQUE("org_id","catalog_key"),
	CONSTRAINT "assemblies_measurement_basis_check" CHECK ("assemblies"."measurement_basis" in ('area', 'perimeter', 'line', 'count')),
	CONSTRAINT "assemblies_pricing_mode_check" CHECK ("assemblies"."pricing_mode" in ('cost_plus', 'unit_rate')),
	CONSTRAINT "assemblies_margin_bps_check" CHECK ("assemblies"."margin_bps" >= 0 and "assemblies"."margin_bps" <= 40000),
	CONSTRAINT "assemblies_job_minimum_check" CHECK ("assemblies"."job_minimum_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "assemblies" ADD CONSTRAINT "assemblies_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assemblies_org_deleted_idx" ON "assemblies" USING btree ("org_id","deleted_at");