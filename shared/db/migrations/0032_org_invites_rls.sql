-- Tenant isolation for org_invites. Same model as jobs (0009), job_visits (0026), and tasks (0028):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset.
--
-- NOTE: The signup-time pending-invite lookup by email runs INSIDE the SECURITY DEFINER fn
-- app_signup_create_org, which executes with table-owner privileges (bypasses RLS).
-- This RLS policy governs only the app-role management queries (inviteMember / listInvites / revokeInvite).

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.org_invites FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY org_invites_tenant_isolation ON public.org_invites
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
