-- Adds the service-type column to jobs. RLS already governs the jobs table
-- (0009_jobs_rls.sql, FORCE + tenant_isolation on org_id) and applies to every
-- column, so no new policy is required. No backfill: existing rows keep svc NULL
-- (rendered as "service" by the DTO mapper's default).
ALTER TABLE "jobs" ADD COLUMN "svc" text;
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_svc_len_check" CHECK ("jobs"."svc" is null or (char_length(btrim("jobs"."svc")) between 1 and 60));