ALTER TABLE "job_visits" ADD COLUMN "enroute_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "enroute_at" timestamp with time zone;