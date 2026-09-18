CREATE TABLE "payment_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"via" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_profiles_last4_check" CHECK ("payment_profiles"."last4" ~ '^[0-9]{4}$'),
	CONSTRAINT "payment_profiles_via_check" CHECK ("payment_profiles"."via" in ('payment', 'deposit'))
);
--> statement-breakpoint
ALTER TABLE "payment_profiles" ADD CONSTRAINT "payment_profiles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_profiles" ADD CONSTRAINT "payment_profiles_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_profiles_org_lead_uidx" ON "payment_profiles" USING btree ("org_id","lead_id");