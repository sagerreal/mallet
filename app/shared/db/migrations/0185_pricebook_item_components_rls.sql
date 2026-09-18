-- Tenant isolation for pricebook_item_components. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0184 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- A component is one shop's costing: what they pay for a post, and what they mark it up to. It
-- is the most commercially sensitive row in the pricebook and must never surface on another's.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.pricebook_item_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pricebook_item_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY pricebook_item_components_tenant_isolation ON public.pricebook_item_components
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
