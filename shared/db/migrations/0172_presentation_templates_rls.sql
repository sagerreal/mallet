-- Tenant isolation for presentation_templates. Same model as every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0171 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- Presentation pages are the shop's own marketing copy (about us, reviews) — low-sensitivity,
-- but it is still one org's voice and must never render on another org's quotes.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.presentation_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.presentation_templates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY presentation_templates_tenant_isolation ON public.presentation_templates
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
