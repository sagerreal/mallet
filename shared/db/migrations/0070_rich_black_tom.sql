CREATE TABLE "frontdesk_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid,
	"vapi_call_id" text NOT NULL,
	"from_number" text NOT NULL,
	"to_number" text NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"transcript" text,
	"messages" jsonb,
	"recording_url" text,
	"summary" text,
	"disposition" text DEFAULT 'no_action' NOT NULL,
	"price_audit" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "frontdesk_tool_invocations" (
	"org_id" uuid NOT NULL,
	"vapi_call_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frontdesk_tool_invocations_org_id_tool_call_id_pk" PRIMARY KEY("org_id","tool_call_id")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "kind" text DEFAULT 'work' NOT NULL;--> statement-breakpoint
ALTER TABLE "frontdesk_calls" ADD CONSTRAINT "frontdesk_calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frontdesk_calls" ADD CONSTRAINT "frontdesk_calls_org_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frontdesk_tool_invocations" ADD CONSTRAINT "frontdesk_tool_invocations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "frontdesk_calls_vapi_call_uidx" ON "frontdesk_calls" USING btree ("org_id","vapi_call_id");--> statement-breakpoint
CREATE INDEX "frontdesk_calls_lead_idx" ON "frontdesk_calls" USING btree ("org_id","lead_id");