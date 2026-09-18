-- Tenant isolation for messages. Same model as tasks (0028) and job_visits (0026): reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. Messages carry their own org_id (stamped on insert), so
-- the runtime role (NOBYPASSRLS) can never address another tenant's messages even with blanket
-- DML grants. The inbound webhook writes privileged (bypasses RLS via owner role) before it
-- switches to withTenant, so the RLS policy does not need to accommodate unauthenticated writes.

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY messages_tenant_isolation ON public.messages
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
