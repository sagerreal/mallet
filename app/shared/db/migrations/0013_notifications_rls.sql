-- Tenant isolation for the notifications ledger. Reuse public.current_org_id() (do NOT redefine),
-- ENABLE + FORCE RLS, one FOR ALL policy keyed on org_id (insert + select + the status-stamp
-- update), fail-closed when unset. Mirror 0011_invoices_rls.sql.

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY notifications_tenant_isolation ON public.notifications
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
