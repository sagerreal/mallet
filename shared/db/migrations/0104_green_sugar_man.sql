CREATE TABLE "painting_room_quantities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(12, 2),
	"derived_value" numeric(12, 2),
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "painting_room_quantities_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "painting_room_quantities_capture_kind_uq" UNIQUE("org_id","capture_id","kind"),
	CONSTRAINT "painting_room_quantities_kind_ck" CHECK ("painting_room_quantities"."kind" in ('walls_sqft','ceiling_sqft','baseboard_lnft','crown_lnft','doors_count','windows_count')),
	CONSTRAINT "painting_room_quantities_status_ck" CHECK ("painting_room_quantities"."status" in ('derived','override','confirmed','needs_confirm'))
);
--> statement-breakpoint
CREATE TABLE "room_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"room_name" text NOT NULL,
	"source" text NOT NULL,
	"raw_payload" jsonb,
	"geometry" jsonb,
	"captured_at" timestamp with time zone NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "room_captures_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "room_captures_source_ck" CHECK ("room_captures"."source" in ('roomplan_v1','manual'))
);
--> statement-breakpoint
ALTER TABLE "painting_room_quantities" ADD CONSTRAINT "painting_room_quantities_capture_fk" FOREIGN KEY ("org_id","capture_id") REFERENCES "public"."room_captures"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_captures" ADD CONSTRAINT "room_captures_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_captures" ADD CONSTRAINT "room_captures_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_captures_org_job_idx" ON "room_captures" USING btree ("org_id","job_id","deleted_at");