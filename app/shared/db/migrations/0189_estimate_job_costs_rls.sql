-- Tenant isolation for estimate_job_costs. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0188 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- A job cost is what a shop PAYS — a sub's day rate, a supplier order, a permit. It is the most
-- commercially sensitive number on a quote and must never surface on another shop's estimate.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.estimate_job_costs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.estimate_job_costs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY estimate_job_costs_tenant_isolation ON public.estimate_job_costs
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
