-- Service origin (front-desk vertical coverage): the address proximity is measured FROM,
-- plus its geocoded lat/lng. All three nullable → additive, back-compatible; existing rows
-- read NULL. No RLS change (org_settings already has FORCE ROW LEVEL SECURITY from its
-- create migration). The jobs_kind_check line drizzle re-emitted here was DROPPED: that
-- constraint already exists live (applied in 0072_jobs_kind_check.sql); re-adding it would
-- fail. The 0074 snapshot now records it, so future db:generate runs won't re-emit it.
ALTER TABLE "org_settings" ADD COLUMN "service_origin_address" text;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "origin_lat" double precision;--> statement-breakpoint
ALTER TABLE "org_settings" ADD COLUMN "origin_lng" double precision;