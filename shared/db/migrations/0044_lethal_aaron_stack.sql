CREATE TABLE "org_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"trade" text DEFAULT 'plumbing' NOT NULL,
	"markup_bps" integer DEFAULT 3500 NOT NULL,
	"visit_scope_minutes" integer DEFAULT 30 NOT NULL,
	"visit_repair_minutes" integer DEFAULT 90 NOT NULL,
	"visit_install_minutes" integer DEFAULT 240 NOT NULL,
	"tech_sees_price" boolean DEFAULT true NOT NULL,
	"tech_texts" boolean DEFAULT true NOT NULL,
	"front_desk" boolean DEFAULT true NOT NULL,
	"scope_on" boolean DEFAULT false NOT NULL,
	"hours_wd_open" integer DEFAULT 8 NOT NULL,
	"hours_wd_close" integer DEFAULT 17 NOT NULL,
	"hours_sat_open" integer DEFAULT 0 NOT NULL,
	"hours_sat_close" integer DEFAULT 0 NOT NULL,
	"hours_sun_open" integer DEFAULT 0 NOT NULL,
	"hours_sun_close" integer DEFAULT 0 NOT NULL,
	"area_cities" text DEFAULT '' NOT NULL,
	"area_radius_mi" integer DEFAULT 25 NOT NULL,
	"booking" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_settings_org_id_uq" UNIQUE("org_id"),
	CONSTRAINT "org_settings_org_id_row_uq" UNIQUE("org_id","id")
);
--> statement-breakpoint
CREATE TABLE "pricebook_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"unit_price_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "labor_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"rate_cents_per_hour" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labor_rates" ADD CONSTRAINT "labor_rates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_terms" ADD CONSTRAINT "job_terms_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pricebook_items_org_deleted_idx" ON "pricebook_items" USING btree ("org_id","deleted_at");--> statement-breakpoint
CREATE INDEX "labor_rates_org_deleted_idx" ON "labor_rates" USING btree ("org_id","deleted_at");--> statement-breakpoint
CREATE INDEX "job_terms_org_deleted_idx" ON "job_terms" USING btree ("org_id","deleted_at");--> statement-breakpoint
CREATE INDEX "lead_sources_org_deleted_idx" ON "lead_sources" USING btree ("org_id","deleted_at");