-- Tenant isolation for quoting_rules. Same model as pricebook_categories (0063),
-- pricebook_materials (0065), checklist_templates (0053), and inbound_endpoints (0059):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy
-- keyed on org_id, fail-closed when unset. The table carries its own org_id (stamped on
-- insert), so the runtime role (NOBYPASSRLS) can never address another tenant's rules
-- even with blanket DML grants. The composite FKs (org_id, service_id) and
-- (org_id, source_estimate_id) close the cross-tenant reference hole owner-side.

ALTER TABLE public.quoting_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.quoting_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY quoting_rules_tenant_isolation ON public.quoting_rules
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
