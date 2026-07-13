-- Tenant isolation for pricebook_materials + pricebook_service_materials. Same model as
-- pricebook_items (0045), pricebook_categories (0063): reuse public.current_org_id() (do NOT
-- redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. Both
-- tables carry their own org_id (materials stamped on insert; the join stamped from the parent
-- service's org), so the runtime role (NOBYPASSRLS) can never address another tenant's rows even
-- with blanket DML grants. The composite FKs already close the cross-tenant link; RLS is
-- defense-in-depth on direct table access.

ALTER TABLE public.pricebook_materials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricebook_materials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY pricebook_materials_tenant_isolation ON public.pricebook_materials
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.pricebook_service_materials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricebook_service_materials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY pricebook_service_materials_tenant_isolation ON public.pricebook_service_materials
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
