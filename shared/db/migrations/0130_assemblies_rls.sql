-- Tenant isolation for estimating assemblies. Same model as site_captures (0123):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. The table carries its own org_id (stamped on insert), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.

ALTER TABLE public.assemblies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.assemblies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY assemblies_tenant_isolation ON public.assemblies
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
