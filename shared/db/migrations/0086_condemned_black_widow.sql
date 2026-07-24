CREATE TABLE "qbo_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"realm_id" text NOT NULL,
	"access_token_sealed" text DEFAULT '' NOT NULL,
	"refresh_token_sealed" text DEFAULT '' NOT NULL,
	"access_expires_at" timestamp with time zone NOT NULL,
	"refresh_expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_by_user_id" uuid,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "qbo_connections_status_check" CHECK ("qbo_connections"."status" in ('active', 'needs_reauth', 'disconnected'))
);
--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD CONSTRAINT "qbo_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD CONSTRAINT "qbo_connections_connected_by_fk" FOREIGN KEY ("org_id","connected_by_user_id") REFERENCES "public"."users"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "qbo_connections_org_uidx" ON "qbo_connections" USING btree ("org_id");