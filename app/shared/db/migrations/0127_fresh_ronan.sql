ALTER TABLE "leads" ADD COLUMN "loss_reason" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "follow_up_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "follow_up_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "addr" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "completion" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "inv_requested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "follow_up_on" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "follow_up_stage" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "auto_remind" boolean DEFAULT true NOT NULL;