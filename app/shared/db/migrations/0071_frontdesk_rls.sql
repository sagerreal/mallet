-- Tenant isolation for frontdesk_calls + frontdesk_tool_invocations. Same model as
-- quoting_rules (0069), pricebook_categories (0063), pricebook_materials (0065), and
-- inbound_endpoints (0059): reuse public.current_org_id() (do NOT redefine), ENABLE +
-- FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. Both tables carry
-- their own org_id (stamped from the To-number lookup, never request payload), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's calls or tool ledger
-- even with blanket DML grants. The composite FK (org_id, lead_id) on frontdesk_calls
-- closes the cross-tenant call→lead reference hole owner-side.

ALTER TABLE public.frontdesk_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.frontdesk_calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY frontdesk_calls_tenant_isolation ON public.frontdesk_calls
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.frontdesk_tool_invocations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.frontdesk_tool_invocations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY frontdesk_tool_invocations_tenant_isolation ON public.frontdesk_tool_invocations
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
