CREATE TABLE "a2p_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"secondary_profile_sid" text,
	"brand_sid" text,
	"messaging_service_sid" text,
	"campaign_sid" text,
	"phone_number_sid" text,
	"business_info" jsonb,
	"otp_verified" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "a2p_registrations" ADD CONSTRAINT "a2p_registrations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "a2p_registrations_org_uidx" ON "a2p_registrations" USING btree ("org_id");