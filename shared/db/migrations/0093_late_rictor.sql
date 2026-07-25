CREATE TABLE "outbound_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"placed_by_user_id" uuid NOT NULL,
	"to_number" text NOT NULL,
	"from_number" text NOT NULL,
	"agent_number" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_call_sid" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"duration_sec" integer,
	"outcome" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "callback_number" text;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_calls_provider_sid_uidx" ON "outbound_calls" USING btree ("org_id","provider_call_sid");--> statement-breakpoint
CREATE INDEX "outbound_calls_lead_idx" ON "outbound_calls" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE INDEX "outbound_calls_created_idx" ON "outbound_calls" USING btree ("org_id","created_at");