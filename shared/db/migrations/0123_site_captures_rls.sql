-- Tenant isolation for site captures (aerial takeoff). Same model as room_captures (0105):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. The table carries its own org_id (stamped on insert), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.

ALTER TABLE public.site_captures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.site_captures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY site_captures_tenant_isolation ON public.site_captures
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
