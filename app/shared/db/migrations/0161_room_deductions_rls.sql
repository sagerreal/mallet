-- Tenant isolation for room deductions. Same model as room_captures / site_captures: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0160 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- A row says which walls of a room are not being painted and why. A cross-tenant READ would
-- disclose another shop's job scope and the reasoning behind its pricing; a cross-tenant WRITE
-- would silently change what another shop's estimate charges for, since walls_sqft is derived net
-- of these rows on every read. The composite FK on (org_id, capture_id) from 0160 backs this up:
-- a deduction cannot even reference a room capture in another org.
--
-- The runtime role is NOBYPASSRLS, so with FORCE enabled these policies bind even for the table
-- owner path used by migrations-adjacent tooling.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.
-- Already live under an earlier number (see 0160's note), so the guard is load-bearing here.

ALTER TABLE public.room_deductions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.room_deductions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY room_deductions_tenant_isolation ON public.room_deductions
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
