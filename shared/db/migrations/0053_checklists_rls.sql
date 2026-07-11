-- Tenant isolation for checklist templates + items. Same model as companies (0038),
-- tasks (0028), and job_visits (0026): reuse public.current_org_id() (do NOT redefine),
-- ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. Both tables
-- carry their own org_id (stamped on insert / copied from the parent template), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.checklist_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY checklist_templates_tenant_isolation ON public.checklist_templates
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.checklist_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY checklist_items_tenant_isolation ON public.checklist_items
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
