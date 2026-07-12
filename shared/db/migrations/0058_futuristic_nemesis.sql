CREATE TABLE "inbound_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"token" text NOT NULL,
	"last_lead_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "inbound_endpoints_org_channel_uq" UNIQUE("org_id","channel"),
	CONSTRAINT "inbound_endpoints_token_uq" UNIQUE("token"),
	CONSTRAINT "inbound_endpoints_channel_check" CHECK ("inbound_endpoints"."channel" in ('form','angi','thumbtack'))
);
--> statement-breakpoint
CREATE TABLE "inbound_lead_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_id" text NOT NULL,
	"lead_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_receipts_dedupe_uq" UNIQUE("org_id","channel","external_id"),
	CONSTRAINT "inbound_receipts_channel_check" CHECK ("inbound_lead_receipts"."channel" in ('form','angi','thumbtack'))
);
--> statement-breakpoint
ALTER TABLE "inbound_endpoints" ADD CONSTRAINT "inbound_endpoints_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_lead_receipts" ADD CONSTRAINT "inbound_lead_receipts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbound_receipts_org_idx" ON "inbound_lead_receipts" USING btree ("org_id");