ALTER TABLE "leads" ALTER COLUMN "unread" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notes" text;