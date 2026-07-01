CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"to_address" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"related_invoice_id" uuid,
	"related_estimate_id" uuid,
	"reminder_stage" smallint,
	"idempotency_key" text NOT NULL,
	"external_id" text,
	"error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_channel_check" CHECK ("notifications"."channel" in ('sms', 'email')),
	CONSTRAINT "notifications_status_check" CHECK ("notifications"."status" in ('queued', 'sent', 'failed')),
	CONSTRAINT "notifications_stage_check" CHECK ("notifications"."reminder_stage" is null or ("notifications"."reminder_stage" between 0 and 2)),
	CONSTRAINT "notifications_related_one_check" CHECK (not ("notifications"."related_invoice_id" is not null and "notifications"."related_estimate_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_invoice_fk" FOREIGN KEY ("org_id","related_invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_estimate_fk" FOREIGN KEY ("org_id","related_estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_idem_uidx" ON "notifications" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_org_created_idx" ON "notifications" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_org_status_idx" ON "notifications" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "notifications_org_invoice_idx" ON "notifications" USING btree ("org_id","related_invoice_id");