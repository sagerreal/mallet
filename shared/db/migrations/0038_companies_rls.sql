-- Tenant isolation for companies. Same model as tasks (0028), jobs (0009), and job_visits (0026):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. Companies carry their own org_id (stamped on insert), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's companies even with blanket DML grants.

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY companies_tenant_isolation ON public.companies
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());