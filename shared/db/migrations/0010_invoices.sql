CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"source_job_line_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"rate_cents" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoice_lines_qty_check" CHECK ("invoice_lines"."quantity" >= 0),
	CONSTRAINT "invoice_lines_rate_check" CHECK ("invoice_lines"."rate_cents" >= 0),
	CONSTRAINT "invoice_lines_cost_check" CHECK ("invoice_lines"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"num" text NOT NULL,
	"source_job_id" uuid,
	"lead_id" uuid NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"deposit_paid_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"terms_days" integer DEFAULT 7 NOT NULL,
	"sent_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "invoices_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'sent', 'partial', 'paid', 'void')),
	CONSTRAINT "invoices_total_check" CHECK ("invoices"."total_cents" >= 0),
	CONSTRAINT "invoices_deposit_check" CHECK ("invoices"."deposit_paid_cents" >= 0 and "invoices"."deposit_paid_cents" <= "invoices"."total_cents"),
	CONSTRAINT "invoices_amount_paid_check" CHECK ("invoices"."amount_paid_cents" >= 0),
	CONSTRAINT "invoices_terms_check" CHECK ("invoices"."terms_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"external_id" text,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_method_check" CHECK ("payments"."method" in ('card', 'ach', 'cash', 'check', 'card_terminal'))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lead_fk" FOREIGN KEY ("org_id","lead_id") REFERENCES "public"."leads"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_source_job_fk" FOREIGN KEY ("org_id","source_job_id") REFERENCES "public"."jobs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("org_id","invoice_id") REFERENCES "public"."invoices"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_org_inv_idx" ON "invoice_lines" USING btree ("org_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoices_org_created_idx" ON "invoices" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_org_status_due_idx" ON "invoices" USING btree ("org_id","status","due_at");--> statement-breakpoint
CREATE INDEX "invoices_org_lead_idx" ON "invoices" USING btree ("org_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_num_uidx" ON "invoices" USING btree ("org_id","num") WHERE "invoices"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_org_source_job_uidx" ON "invoices" USING btree ("org_id","source_job_id") WHERE "invoices"."source_job_id" is not null and "invoices"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_org_idem_uidx" ON "payments" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_org_invoice_idx" ON "payments" USING btree ("org_id","invoice_id","received_at" DESC NULLS LAST);