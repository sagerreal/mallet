-- Signup provisioning seam (mirrors app_resolve_principal / app_resolve_api_key): a NEW user has a
-- verified Supabase identity but no org, so provisioning cannot run under withTenant. Rather than a
-- BYPASSRLS connection, one narrow SECURITY DEFINER function creates org + owner mapping atomically.
-- Idempotent: an already-provisioned auth user gets their existing org back (safe to call on every
-- login). Concurrent duplicate signups collapse via the users_auth_user_uidx unique index.
CREATE OR REPLACE FUNCTION public.app_signup_create_org(p_auth_user_id uuid, p_email text, p_org_name text)
  RETURNS TABLE (org_id uuid, role text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT u.org_id, u.role INTO org_id, role FROM public.users u WHERE u.auth_user_id = p_auth_user_id;
  IF FOUND THEN RETURN NEXT; RETURN; END IF;

  BEGIN
    INSERT INTO public.orgs (name) VALUES (p_org_name) RETURNING id INTO v_org;
    INSERT INTO public.users (org_id, auth_user_id, email, role) VALUES (v_org, p_auth_user_id, p_email, 'owner');
    org_id := v_org; role := 'owner';
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a concurrent race: the other tx provisioned this auth user. Return theirs.
    SELECT u.org_id, u.role INTO org_id, role FROM public.users u WHERE u.auth_user_id = p_auth_user_id;
    RETURN NEXT;
  END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_signup_create_org(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mallet_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_signup_create_org(uuid, text, text) TO mallet_app;
  END IF;
END $$;
