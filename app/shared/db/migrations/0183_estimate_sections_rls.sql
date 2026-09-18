-- Tenant isolation for estimate_sections. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0182 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- A section is a heading on a customer quote ("Demolition & site prep"). It carries no money,
-- but it names one shop's work on one shop's estimate and must never surface on another's.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.estimate_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.estimate_sections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY estimate_sections_tenant_isolation ON public.estimate_sections
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
