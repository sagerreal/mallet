CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"description" text NOT NULL,
	"qty" numeric(12, 3) DEFAULT '1' NOT NULL,
	"uom" text DEFAULT 'ea' NOT NULL,
	"unit_cost_millicents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"po_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"author_user_id" uuid,
	"attachment_path" text,
	"attachment_name" text,
	"attachment_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_order_notes_shape_check" CHECK (length(trim("purchase_order_notes"."body")) > 0 or "purchase_order_notes"."attachment_path" is not null)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"num" text,
	"vendor" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"job_id" uuid,
	"ordered_at" date,
	"expected_at" date,
	"ship_to" text DEFAULT 'counter_pickup' NOT NULL,
	"ordered_by_user_id" uuid,
	"freight_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "purchase_orders_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "purchase_orders_status_check" CHECK ("purchase_orders"."status" in ('draft','ordered','cancelled')),
	CONSTRAINT "purchase_orders_ship_to_check" CHECK ("purchase_orders"."ship_to" in ('counter_pickup','job_site','shop')),
	CONSTRAINT "purchase_orders_num_check" CHECK (("purchase_orders"."status" = 'draft') = ("purchase_orders"."num" is null))
);
--> statement-breakpoint
ALTER TABLE "number_sequences" DROP CONSTRAINT "number_sequences_kind_check";--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_org_po_fk" FOREIGN KEY ("org_id","po_id") REFERENCES "public"."purchase_orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_notes" ADD CONSTRAINT "purchase_order_notes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_notes" ADD CONSTRAINT "purchase_order_notes_org_po_fk" FOREIGN KEY ("org_id","po_id") REFERENCES "public"."purchase_orders"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_org_po_idx" ON "purchase_order_lines" USING btree ("org_id","po_id","position");--> statement-breakpoint
CREATE INDEX "purchase_order_notes_org_po_idx" ON "purchase_order_notes" USING btree ("org_id","po_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_org_num_uidx" ON "purchase_orders" USING btree ("org_id","num") WHERE deleted_at is null and num is not null;--> statement-breakpoint
CREATE INDEX "purchase_orders_org_created_idx" ON "purchase_orders" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "purchase_orders_org_job_idx" ON "purchase_orders" USING btree ("org_id","job_id");--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_kind_check" CHECK ("number_sequences"."kind" in ('estimate', 'invoice', 'job', 'po'));