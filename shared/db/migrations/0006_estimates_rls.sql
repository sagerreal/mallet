-- Tenant isolation for the quoting tables. Same model as leads/users (0001/0003): reuse the
-- existing public.current_org_id() (do NOT redefine it), ENABLE + FORCE RLS, and a FOR ALL policy
-- keyed on org_id. Fail-closed when no org is set. The runtime role (mallet_app) is auto-granted
-- DML on new tables via ALTER DEFAULT PRIVILEGES set in scripts/setup-app-role.mjs.

ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.estimates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.estimate_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.estimate_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.number_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.number_sequences FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY estimates_tenant_isolation ON public.estimates
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY estimate_lines_tenant_isolation ON public.estimate_lines
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

CREATE POLICY number_sequences_tenant_isolation ON public.number_sequences
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
