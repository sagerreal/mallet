CREATE TABLE "estimate_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"payment_ref" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "estimate_deposits_amount_check" CHECK ("estimate_deposits"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "estimate_deposits" ADD CONSTRAINT "estimate_deposits_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_deposits" ADD CONSTRAINT "estimate_deposits_estimate_fk" FOREIGN KEY ("org_id","estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "estimate_deposits_org_ref_uidx" ON "estimate_deposits" USING btree ("org_id","payment_ref");--> statement-breakpoint
CREATE INDEX "estimate_deposits_org_estimate_idx" ON "estimate_deposits" USING btree ("org_id","estimate_id","received_at" DESC NULLS LAST);