-- Tenant isolation for pricebook_categories. Same model as pricebook_items (0045),
-- checklist_templates (0053), and inbound_endpoints (0059): reuse public.current_org_id()
-- (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when
-- unset. The table carries its own org_id (stamped on insert), so the runtime role
-- (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.
-- pricebook_items already has its own RLS from 0045 — untouched here.

ALTER TABLE public.pricebook_categories ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricebook_categories FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY pricebook_categories_tenant_isolation ON public.pricebook_categories
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
