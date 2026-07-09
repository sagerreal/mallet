CREATE TABLE "org_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "org_invites_role_check" CHECK ("org_invites"."role" in ('owner', 'office', 'tech')),
	CONSTRAINT "org_invites_status_check" CHECK ("org_invites"."status" in ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "org_invites" ADD CONSTRAINT "org_invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_invites_org_status_idx" ON "org_invites" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "org_invites_org_email_idx" ON "org_invites" USING btree ("org_id","email");