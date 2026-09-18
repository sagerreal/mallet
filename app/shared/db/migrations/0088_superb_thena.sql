CREATE TABLE "qbo_entity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"mallet_id" text NOT NULL,
	"qbo_id" text NOT NULL,
	"qbo_sync_token" text,
	"qbo_entity_kind" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qbo_entity_links_type_check" CHECK ("qbo_entity_links"."entity_type" in ('employee', 'customer', 'service_item')),
	CONSTRAINT "qbo_entity_links_kind_check" CHECK ("qbo_entity_links"."qbo_entity_kind" is null or "qbo_entity_links"."qbo_entity_kind" in ('Employee', 'Vendor'))
);
--> statement-breakpoint
CREATE TABLE "qbo_sync_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"mallet_id" text NOT NULL,
	"qbo_id" text,
	"status" text NOT NULL,
	"error_code" text,
	"error_message" text,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qbo_sync_log_status_check" CHECK ("qbo_sync_log"."status" in ('succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD COLUMN "default_item_qbo_id" text;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD COLUMN "default_item_name" text;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD COLUMN "send_approved_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qbo_entity_links" ADD CONSTRAINT "qbo_entity_links_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_sync_log" ADD CONSTRAINT "qbo_sync_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_entity_links_org_type_mallet_uidx" ON "qbo_entity_links" USING btree ("org_id","entity_type","mallet_id");--> statement-breakpoint
CREATE INDEX "qbo_entity_links_org_type_idx" ON "qbo_entity_links" USING btree ("org_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_sync_log_succeeded_uidx" ON "qbo_sync_log" USING btree ("org_id","entity_type","mallet_id") WHERE "qbo_sync_log"."status" = 'succeeded';--> statement-breakpoint
CREATE INDEX "qbo_sync_log_org_attempted_idx" ON "qbo_sync_log" USING btree ("org_id","attempted_at");