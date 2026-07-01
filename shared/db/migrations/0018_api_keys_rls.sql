-- RLS for api_keys + the key-resolution seam (mirrors 0003_users_rls_and_resolver.sql).
--
-- Within a tenant, an org's members manage their own keys (org_id = current_org_id()). But resolving
-- a presented key to its tenant happens BEFORE any org is known, so it cannot go through withTenant.
-- Rather than hand the runtime role a BYPASSRLS connection, expose a narrow SECURITY DEFINER function
-- that returns only the one unrevoked row matching a key hash.

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY api_keys_tenant_isolation ON public.api_keys
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

-- Resolve a presented key HASH to its (id, org_id, role), unrevoked only. SECURITY DEFINER so it runs
-- as the owner and can read api_keys regardless of the caller's tenant; STABLE; pinned search_path.
-- Returns 0 rows for an unknown/revoked key. The app never passes a raw key here — only its hash.
CREATE OR REPLACE FUNCTION public.app_resolve_api_key(p_hashed_key text)
  RETURNS TABLE (id uuid, org_id uuid, role text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id, org_id, role FROM public.api_keys WHERE hashed_key = p_hashed_key AND revoked_at IS NULL;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_resolve_api_key(text) FROM PUBLIC;
--> statement-breakpoint
-- Grant to the app role if it exists; setup-app-role.mjs re-issues on a fresh DB (order-safe).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mallet_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_resolve_api_key(text) TO mallet_app;
  END IF;
END $$;
