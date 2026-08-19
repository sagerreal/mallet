-- Tenant isolation for square_connections. Same model as qbo_connections: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset. drizzle-kit does not emit RLS, so 0166 created the table WITHOUT it —
-- this file is the half that makes it tenant-safe.
--
-- THIS IS THE HIGHEST-VALUE ROW IN THE SCHEMA TO ISOLATE. It holds a sealed OAuth token that
-- authorises taking payments against a real merchant account. A cross-tenant READ hands one shop
-- the credentials to charge another shop's customers; a cross-tenant WRITE could repoint a shop's
-- payouts. The FK to orgs backs this up, but the policy is what enforces it at read time.
--
-- The runtime role is NOBYPASSRLS, so with FORCE enabled these policies bind even for the table
-- owner path used by migrations-adjacent tooling.
--
-- Guarded because CREATE POLICY has no IF NOT EXISTS; ENABLE/FORCE are idempotent in Postgres.

ALTER TABLE public.square_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.square_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY square_connections_tenant_isolation ON public.square_connections
    FOR ALL
    USING (org_id = public.current_org_id())
    WITH CHECK (org_id = public.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
