-- Tenant isolation for crew_schedules. Same model as frontdesk_calls (0071), quoting_rules
-- (0069), and inbound_endpoints (0059): reuse public.current_org_id() (do NOT redefine), ENABLE +
-- FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. The table carries its own
-- org_id, so the runtime role (NOBYPASSRLS) can never address another tenant's crew schedules even
-- with blanket DML grants. The composite FK (org_id, user_id) → users(org_id, id) closes the
-- cross-tenant schedule→user reference hole owner-side.

ALTER TABLE public.crew_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.crew_schedules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY crew_schedules_tenant_isolation ON public.crew_schedules
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
