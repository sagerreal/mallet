-- Tenant isolation for timesheet submissions. Same model as payment_profiles (0151) /
-- time_entries (0036): reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS,
-- FOR ALL policy keyed on org_id, fail-closed when unset. drizzle-kit does not emit RLS, so
-- 0156 created the table WITHOUT it — this file is the half that makes it tenant-safe.
--
-- The row is a payroll attestation (who submitted which week, and whether new hours reopened it).
-- A cross-tenant READ would disclose another shop's payroll cadence; a cross-tenant WRITE could
-- fabricate or reopen another shop's attestations. The composite FK on (org_id, tech_user_id) from
-- 0156 backs this up: a submission cannot even reference a technician in another org.
--
-- The runtime role is NOBYPASSRLS, so with FORCE enabled these policies bind even for the table
-- owner path used by migrations-adjacent tooling.
--
-- RE-RUNNABLE, for the reason 0156 documents: this policy already exists on the shared database
-- under an earlier number. ENABLE/FORCE are idempotent in Postgres; the policy itself is guarded,
-- because CREATE POLICY has no IF NOT EXISTS.

ALTER TABLE public.timesheet_submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.timesheet_submissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY timesheet_submissions_tenant_isolation ON public.timesheet_submissions
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
