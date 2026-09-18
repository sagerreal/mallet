-- Tenant isolation for invoices, invoice_lines, and the payments ledger. Same model as the other
-- scoped tables: reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, one FOR ALL
-- policy keyed on org_id, fail-closed when unset. payments is append-only by app discipline and by
-- having no update/delete columns, so a single FOR ALL policy (insert + select) is sufficient.

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.invoice_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY invoices_tenant_isolation ON public.invoices
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY invoice_lines_tenant_isolation ON public.invoice_lines
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY payments_tenant_isolation ON public.payments
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
