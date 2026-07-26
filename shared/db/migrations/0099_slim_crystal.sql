ALTER TABLE "messages" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "status_at" timestamp with time zone;