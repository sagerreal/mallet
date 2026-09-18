-- Tenant isolation for the settings tables. Same model as companies (0038) and tasks (0028):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. Each table carries its own org_id (stamped on insert / lazily
-- created), so the runtime role (NOBYPASSRLS) can never address another tenant's settings.

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.org_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_settings_tenant_isolation ON public.org_settings
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.pricebook_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricebook_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pricebook_items_tenant_isolation ON public.pricebook_items
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.labor_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY labor_rates_tenant_isolation ON public.labor_rates
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.job_terms ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.job_terms FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY job_terms_tenant_isolation ON public.job_terms
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lead_sources_tenant_isolation ON public.lead_sources
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
