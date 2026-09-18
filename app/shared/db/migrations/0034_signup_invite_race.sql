-- Harden the invite-join branch of app_signup_create_org against a concurrent double
-- first-signup: wrap the invited-user INSERT in a unique_violation handler (mirroring the
-- fresh-org branch) so a lost race falls through to the idempotent re-select instead of a 500.
-- Full CREATE OR REPLACE (0033's version, invite-join branch now race-safe).

CREATE OR REPLACE FUNCTION public.app_signup_create_org(
  p_auth_user_id uuid,
  p_email        text,
  p_org_name     text,
  p_name         text DEFAULT NULL
)
  RETURNS TABLE (org_id uuid, role text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_org      uuid;
  v_inv_org  uuid;
  v_inv_role text;
BEGIN
  -- Already provisioned: return existing mapping (idempotent).
  SELECT u.org_id, u.role INTO org_id, role
    FROM public.users u
   WHERE u.auth_user_id = p_auth_user_id;
  IF FOUND THEN RETURN NEXT; RETURN; END IF;

  -- Lookup a pending invite for this email (SECURITY DEFINER bypasses RLS — intentional,
  -- because the invite may belong to any org and the user has no principal yet).
  SELECT i.org_id, i.role INTO v_inv_org, v_inv_role
    FROM public.org_invites i
   WHERE lower(i.email) = lower(p_email)
     AND i.status = 'pending'
   ORDER BY i.created_at DESC
   LIMIT 1;

  IF FOUND THEN
    -- Join the inviting org with the invited role. Wrapped in a unique_violation handler
    -- (mirroring the fresh-org branch) so a concurrent double first-signup for the same
    -- auth_user_id falls through to the idempotent re-select instead of erroring.
    BEGIN
      INSERT INTO public.users (org_id, auth_user_id, email, name, role, is_field_crew)
        VALUES (
          v_inv_org,
          p_auth_user_id,
          p_email,
          p_name,
          v_inv_role,
          v_inv_role IN ('owner', 'tech')
        );

      -- Mark all pending invites for this email in this org as accepted.
      UPDATE public.org_invites AS oi
         SET status = 'accepted', accepted_at = now()
       WHERE oi.org_id = v_inv_org
         AND lower(oi.email) = lower(p_email)
         AND oi.status = 'pending';

      org_id := v_inv_org;
      role   := v_inv_role;
      RETURN NEXT;
      RETURN;
    EXCEPTION WHEN unique_violation THEN
      -- Lost a concurrent race: the other tx already provisioned this auth user. Return theirs.
      SELECT u.org_id, u.role INTO org_id, role
        FROM public.users u
       WHERE u.auth_user_id = p_auth_user_id;
      RETURN NEXT;
      RETURN;
    END;
  END IF;

  -- No pending invite — create a fresh org + owner user.
  BEGIN
    INSERT INTO public.orgs (name) VALUES (p_org_name) RETURNING id INTO v_org;
    INSERT INTO public.users (org_id, auth_user_id, email, name, role, is_field_crew)
      VALUES (v_org, p_auth_user_id, p_email, p_name, 'owner', true);
    org_id := v_org; role := 'owner';
    RETURN NEXT;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a concurrent race: the other tx provisioned this auth user. Return theirs.
    SELECT u.org_id, u.role INTO org_id, role
      FROM public.users u
     WHERE u.auth_user_id = p_auth_user_id;
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
