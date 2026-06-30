CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"email" text,
	"source" text,
	"stage" text DEFAULT 'new' NOT NULL,
	"value_cents" integer DEFAULT 0 NOT NULL,
	"unread" boolean DEFAULT true NOT NULL,
	"won_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_org_created_idx" ON "leads" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "leads_org_phone_uidx" ON "leads" USING btree ("org_id","phone_e164") WHERE "leads"."deleted_at" is null and "leads"."phone_e164" is not null;