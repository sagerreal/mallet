-- RLS for users + the principal-resolution seam.
--
-- Within a tenant, members can see their team (org_id = current_org_id()). But resolving a
-- session to its tenant happens BEFORE any org is known (chicken-and-egg), so it cannot go
-- through withTenant. Rather than hand the runtime role a BYPASSRLS connection, we expose a
-- narrow SECURITY DEFINER function the app role may call: it returns only the one row matching
-- a verified auth_user_id.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY users_tenant_isolation ON public.users
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

-- Resolve a Supabase auth user to its (user_id, org_id, role). SECURITY DEFINER so it runs as
-- the owner and can read users regardless of the caller's tenant; STABLE; pinned search_path
-- to prevent function/table hijacking. Returns 0 rows for an unprovisioned auth user.
CREATE OR REPLACE FUNCTION public.app_resolve_principal(p_auth_user_id uuid)
  RETURNS TABLE (user_id uuid, org_id uuid, role text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT id, org_id, role FROM public.users WHERE auth_user_id = p_auth_user_id;
$$;
--> statement-breakpoint

-- Least privilege: only the app role may call it; revoke the implicit PUBLIC grant.
REVOKE ALL ON FUNCTION public.app_resolve_principal(uuid) FROM PUBLIC;
--> statement-breakpoint
-- Grant to the app role if it already exists. On a fresh DB the role is created afterward by
-- scripts/setup-app-role.mjs, which (re)issues this grant — so migrations never fail on order.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mallet_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_resolve_principal(uuid) TO mallet_app;
  END IF;
END $$;
