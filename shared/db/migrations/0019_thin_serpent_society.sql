CREATE TABLE "tool_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tool_confirmations" ADD CONSTRAINT "tool_confirmations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tool_confirmations_token_hash_uidx" ON "tool_confirmations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tool_confirmations_org_idx" ON "tool_confirmations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tool_confirmations_expires_idx" ON "tool_confirmations" USING btree ("expires_at");