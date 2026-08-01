CREATE TABLE "site_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"surface" text NOT NULL,
	"pitch_rise" integer,
	"polygon" jsonb,
	"footprint_sqft" numeric(12, 2),
	"area_sqft" numeric(12, 2) NOT NULL,
	"perimeter_lnft" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "site_captures_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "site_captures_source_ck" CHECK ("site_captures"."source" in ('aerial_trace_v1','manual')),
	CONSTRAINT "site_captures_surface_ck" CHECK ("site_captures"."surface" in ('flat','pitched')),
	CONSTRAINT "site_captures_pitch_ck" CHECK (("site_captures"."surface" = 'flat' and "site_captures"."pitch_rise" is null) or ("site_captures"."surface" = 'pitched' and "site_captures"."pitch_rise" between 1 and 24))
);
--> statement-breakpoint
ALTER TABLE "site_captures" ADD CONSTRAINT "site_captures_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_captures" ADD CONSTRAINT "site_captures_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_captures_org_job_idx" ON "site_captures" USING btree ("org_id","job_id","deleted_at");