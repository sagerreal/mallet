-- Tenant isolation for time_entries. Same model as tasks (0028) and job_visits (0026):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy
-- keyed on org_id, fail-closed when unset. Time entries carry their own org_id (stamped on
-- insert), so the runtime role (NOBYPASSRLS) can never address another tenant's entries.

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.time_entries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY time_entries_tenant_isolation ON public.time_entries
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
