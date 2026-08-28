CREATE TABLE "estimate_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"estimate_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "estimate_sections_org_id_key" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "qty_expr" text;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "round_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "parent_line_id" uuid;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "customer_visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD COLUMN "markup_bps" integer;--> statement-breakpoint
ALTER TABLE "estimate_sections" ADD CONSTRAINT "estimate_sections_estimate_fk" FOREIGN KEY ("org_id","estimate_id") REFERENCES "public"."estimates"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_sections_org_est_idx" ON "estimate_sections" USING btree ("org_id","estimate_id");--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_org_id_uq" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_parent_fk" FOREIGN KEY ("org_id","parent_line_id") REFERENCES "public"."estimate_lines"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_section_fk" FOREIGN KEY ("org_id","section_id") REFERENCES "public"."estimate_sections"("org_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "estimate_lines_org_parent_idx" ON "estimate_lines" USING btree ("org_id","parent_line_id");--> statement-breakpoint
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_markup_check" CHECK ("estimate_lines"."markup_bps" is null or "estimate_lines"."markup_bps" >= 0);