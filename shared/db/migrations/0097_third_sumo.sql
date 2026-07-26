ALTER TABLE "qbo_connections" ADD COLUMN "default_invoice_item_qbo_id" text;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD COLUMN "default_invoice_item_name" text;--> statement-breakpoint
ALTER TABLE "qbo_connections" ADD COLUMN "send_invoices" boolean DEFAULT false NOT NULL;