-- Tenant isolation via Row-Level Security.
--
-- The runtime role (mallet_app, NOBYPASSRLS — see scripts/setup-app-role.mjs) is subject
-- to these policies. withTenant() sets the transaction-local GUC app.current_org_id before
-- any query runs. With no org set, current_org_id() is NULL and every policy denies, so an
-- unscoped query fails closed (returns nothing) rather than leaking across tenants.
--
-- These statements run as the table owner (postgres). The owner has BYPASSRLS, so it is
-- never used for runtime tenant queries — only migrations and privileged service paths.

-- Resolve the current tenant from a transaction-local GUC. STABLE; missing_ok=true so an
-- unset GUC yields NULL instead of erroring. NULLIF maps the empty string to NULL.
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
  LANGUAGE sql
  STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_org_id', true), '')::uuid;
$$;
--> statement-breakpoint

-- FORCE so the policies also bind the table owner (defense in depth); ENABLE is what makes
-- them bind the non-owner runtime role.
ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.orgs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.leads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- An org row is visible only to its own tenant. Creating orgs (signup) is a privileged
-- path that runs as the owner, so no permissive insert path is needed for the app role.
CREATE POLICY orgs_tenant_isolation ON public.orgs
  FOR ALL
  USING (id = public.current_org_id())
  WITH CHECK (id = public.current_org_id());
--> statement-breakpoint

-- Reads, updates, and deletes are scoped by org_id; WITH CHECK stops a tenant from writing
-- a row tagged with someone else's org_id.
CREATE POLICY leads_tenant_isolation ON public.leads
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
