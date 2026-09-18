-- Tenant isolation for job_visits. Same model as jobs (0009): reuse public.current_org_id()
-- (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset.
-- The child-collection table carries its own org_id (stamped on insert), so it isolates
-- independently of its parent job — the runtime role (NOBYPASSRLS) can never address another
-- tenant's visits even though it holds blanket DML grants.

ALTER TABLE public.job_visits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_visits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY job_visits_tenant_isolation ON public.job_visits
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
