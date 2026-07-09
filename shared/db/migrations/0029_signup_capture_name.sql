-- Update app_signup_create_org to accept an optional display name and store it on the users row.
-- Adds p_name text parameter (nullable) — existing callers passing 3 args continue to work because
-- the new parameter has a DEFAULT NULL. The SECURITY DEFINER context has privileges to insert name.
-- Idempotent: if the user already exists their name is NOT overwritten (existing provisioned
-- users are handled by the separate backfill migration 0030).
CREATE OR REPLACE FUNCTION public.app_signup_create_org(p_auth_user_id uuid, p_email text, p_org_name text, p_name text DEFAULT NULL)
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
    INSERT INTO public.users (org_id, auth_user_id, email, name, role) VALUES (v_org, p_auth_user_id, p_email, p_name, 'owner');
    org_id := v_org; role := 'owner';
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a concurrent race: the other tx provisioned this auth user. Return theirs.
    SELECT u.org_id, u.role INTO org_id, role FROM public.users u WHERE u.auth_user_id = p_auth_user_id;
    RETURN NEXT;
  END;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_signup_create_org(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mallet_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_signup_create_org(uuid, text, text, text) TO mallet_app;
  END IF;
END $$;