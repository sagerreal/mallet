-- Tenant isolation for pipeline_stages. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0168 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- Stage names are the shop's own process vocabulary ("Adjuster meeting", "Supplement filed") —
-- low-sensitivity data, but the composite FK from leads means a readable foreign stage row would
-- also be a linkable one. The policy closes both.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.pipeline_stages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY pipeline_stages_tenant_isolation ON public.pipeline_stages
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
