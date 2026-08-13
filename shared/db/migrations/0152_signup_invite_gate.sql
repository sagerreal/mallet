-- Read-only companion to app_signup_create_org: does this email hold a pending invite?
-- SECURITY DEFINER for the same reason as the signup fn itself — the caller has no principal
-- yet, so RLS on org_invites would hide the very row that authorizes them to join. Used by
-- identity.signup to keep the invited-joiner path open while self-serve org creation is closed
-- (Mallet is invite-only during the pilot; see modules/identity/api/identity-router.ts).
CREATE OR REPLACE FUNCTION public.app_has_pending_invite(p_email text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.org_invites i
     WHERE lower(i.email) = lower(p_email)
       AND i.status = 'pending'
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_has_pending_invite(text) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mallet_app') THEN
    GRANT EXECUTE ON FUNCTION public.app_has_pending_invite(text) TO mallet_app;
  END IF;
END $$;
