-- Tenant isolation for staff_sms_sessions. Same model as outbound_calls (0094), qbo_connections
-- (0087), a2p_registrations (0085) and inbound_endpoints (0059): reuse public.current_org_id()
-- (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset.
--
-- This table holds a staffer's mobile number and the full transcript of what they asked the agent
-- to do — which quotes they discussed, which customers, which invoices. A cross-tenant read would
-- hand one shop a narrated tour of another shop's operations, so FORCE matters: it applies the
-- policy to the table owner too, not only to ordinary roles.
--
-- NOTE: the inbound SMS webhook resolves the owning org through ownerDb (BYPASSRLS) because a
-- Twilio callback carries no principal — exactly as the voice webhooks do. That reader returns
-- ONLY an org id; every read and write of session data afterwards runs inside withTenant, under
-- this policy.

ALTER TABLE "staff_sms_sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "staff_sms_sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "staff_sms_sessions_tenant_isolation" ON "staff_sms_sessions"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
