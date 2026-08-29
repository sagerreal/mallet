-- Tenant isolation for the purchasing tables. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0180 created these WITHOUT it.
--
-- Purchase orders carry what a shop pays its suppliers — the most commercially sensitive figure
-- in the app. A leak here hands a competitor the shop's margin.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.purchase_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY purchase_orders_tenant_isolation ON public.purchase_orders
    FOR ALL USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.purchase_order_lines FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY purchase_order_lines_tenant_isolation ON public.purchase_order_lines
    FOR ALL USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
ALTER TABLE public.purchase_order_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.purchase_order_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY purchase_order_notes_tenant_isolation ON public.purchase_order_notes
    FOR ALL USING (org_id = public.current_org_id()) WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
