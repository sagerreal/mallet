-- Tenant isolation for tasks. Same model as jobs (0009) and job_visits (0026): reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. Tasks carry their own org_id (stamped on insert), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's tasks even with blanket DML grants.

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tasks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tasks_tenant_isolation ON public.tasks
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());