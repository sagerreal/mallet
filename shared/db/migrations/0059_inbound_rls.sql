-- Tenant isolation for inbound lead intake. Same model as checklist_templates/items (0053)
-- and job execution tables (0049): reuse public.current_org_id() (do NOT redefine), ENABLE +
-- FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset. Both tables carry their
-- own org_id (stamped on insert), so the runtime role (NOBYPASSRLS) can never address another
-- tenant's rows even with blanket DML grants.

ALTER TABLE public.inbound_endpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.inbound_endpoints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY inbound_endpoints_tenant_isolation ON public.inbound_endpoints
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.inbound_lead_receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.inbound_lead_receipts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY inbound_lead_receipts_tenant_isolation ON public.inbound_lead_receipts
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
