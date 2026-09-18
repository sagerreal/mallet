CREATE TABLE "estimate_job_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"purchase_order_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "estimate_job_costs_org_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "estimate_job_costs_amount_check" CHECK ("estimate_job_costs"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "estimate_job_costs" ADD CONSTRAINT "estimate_job_costs_estimate_fk" FOREIGN KEY ("org_id","estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_job_costs_org_est_idx" ON "estimate_job_costs" USING btree ("org_id","estimate_id");