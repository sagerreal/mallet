CREATE TABLE "staff_sms_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"transcript" text,
	"pending_json" text,
	"pending_summary" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "callback_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_sms_sessions" ADD CONSTRAINT "staff_sms_sessions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_sms_sessions_org_phone_uidx" ON "staff_sms_sessions" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "staff_sms_sessions_org_idx" ON "staff_sms_sessions" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "staff_sms_sessions_user_idx" ON "staff_sms_sessions" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_verified_callback_uidx" ON "users" USING btree ("org_id","callback_number") WHERE "users"."callback_verified_at" is not null;--> statement-breakpoint
-- Composite FK, hand-added: drizzle-kit cannot emit one from a bare uuid column. Points at
-- users(org_id, id) rather than users(id) so a session can never reference another org's staffer —
-- the same guarantee jobs.assignee_user_id uses. ON DELETE CASCADE: a removed staffer's live text
-- conversation should not outlive them.
ALTER TABLE "staff_sms_sessions" ADD CONSTRAINT "staff_sms_sessions_org_user_fk"
  FOREIGN KEY ("org_id","user_id") REFERENCES "public"."users"("org_id","id")
  ON DELETE cascade ON UPDATE no action;
