CREATE TABLE "estimate_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"needs_photo" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "estimate_lines_qty_check" CHECK ("estimate_lines"."quantity" >= 0),
	CONSTRAINT "estimate_lines_rate_check" CHECK ("estimate_lines"."rate_cents" >= 0),
	CONSTRAINT "estimate_lines_cost_check" CHECK ("estimate_lines"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"num" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"disc_bps" integer DEFAULT 0 NOT NULL,
	"tax_bps" integer DEFAULT 0 NOT NULL,
	"dep_bps" integer DEFAULT 0 NOT NULL,
	"dep_paid_cents" integer DEFAULT 0 NOT NULL,
	"valid_days" integer,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "estimates_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "estimates_status_check" CHECK ("estimates"."status" in ('draft', 'sent', 'accepted', 'declined')),
	CONSTRAINT "estimates_disc_bps_check" CHECK ("estimates"."disc_bps" between 0 and 10000),
	CONSTRAINT "estimates_tax_bps_check" CHECK ("estimates"."tax_bps" >= 0),
	CONSTRAINT "estimates_dep_bps_check" CHECK ("estimates"."dep_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"next_val" integer DEFAULT 1000 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "number_sequences_org_id_kind_pk" PRIMARY KEY("org_id","kind"),
	CONSTRAINT "number_sequences_kind_check" CHECK ("number_sequences"."kind" in ('estimate', 'invoice', 'job'))
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_estimate_fk" FOREIGN KEY ("org_id","estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_lines_org_est_idx" ON "estimate_lines" USING btree ("org_id","estimate_id");--> statement-breakpoint
CREATE INDEX "estimates_org_created_idx" ON "estimates" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "estimates_org_lead_idx" ON "estimates" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_org_num_uidx" ON "estimates" USING btree ("org_id","num") WHERE "estimates"."deleted_at" is null;