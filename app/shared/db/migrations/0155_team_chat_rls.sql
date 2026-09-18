-- Tenant isolation for staff messaging. Same model as payment_profiles (0151) /
-- estimate_deposits (0136): reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS,
-- FOR ALL policy keyed on org_id, fail-closed when unset. drizzle-kit does not emit RLS, so
-- 0154 created these three tables WITHOUT it — this file is the half that makes them safe to
-- hold what staff say to each other.
--
-- What a leak would cost here is different in kind from the other tables. These rows are not
-- business records, they are private conversation: a cross-tenant READ would hand one shop the
-- text of another shop's crew talking, and a cross-tenant WRITE would let a stranger speak
-- inside a shop's thread as one of its own people. The composite FKs from 0154 back this up —
-- (org_id, thread_id) → team_threads(org_id, id) and (org_id, user_id) → users(org_id, id) —
-- so a membership row cannot even name a user from another org.
--
-- NOTE ON SCOPE: org_id is the TENANT boundary, not the privacy boundary. Membership of a
-- specific thread is enforced in the application layer (TeamChatRepository.isMember, called by
-- every read and write in the team-chat router) because RLS here has no notion of the current
-- USER — current_org_id() is all the tenant session carries. That split is deliberate and
-- matches the rest of the app; it is why the router gates and their integration tests are the
-- load-bearing part of the privacy story, not this file.
--
-- The runtime role is NOBYPASSRLS, so with FORCE enabled these policies bind even for the table
-- owner path used by migrations-adjacent tooling.

ALTER TABLE public.team_threads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.team_threads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY team_threads_tenant_isolation ON public.team_threads
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.team_thread_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.team_thread_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY team_thread_members_tenant_isolation ON public.team_thread_members
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
--> statement-breakpoint

ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.team_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY team_messages_tenant_isolation ON public.team_messages
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
