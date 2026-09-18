-- Tenant isolation for jobs. Same model as the other scoped tables: reuse public.current_org_id()
-- (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset.
-- No tech-restrictive policy in the pilot (deferred with visits/time_entries).

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY jobs_tenant_isolation ON public.jobs
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
