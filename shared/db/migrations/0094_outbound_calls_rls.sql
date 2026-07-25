-- Tenant isolation for outbound_calls. Same model as qbo_connections (0087), a2p_registrations
-- (0085), frontdesk_calls (0071), quoting_rules (0069), pricebook_materials (0065) and
-- inbound_endpoints (0059): reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS,
-- FOR ALL policy keyed on org_id, fail-closed when unset.
--
-- This table holds every number a shop has dialed, who dialed it, and the notes taken during the
-- call — a customer contact log plus staff mobile numbers. A cross-tenant read would hand one
-- shop another shop's customer list, so FORCE matters: it applies the policy to the table owner
-- too, not just to ordinary roles.
--
-- NOTE: the two voice webhooks resolve the owning org through ownerDb (BYPASSRLS) because a
-- Twilio callback carries no principal. Those readers return ONLY an org id; every read and
-- write of call data afterwards runs inside withTenant, under this policy.
--
-- users.callback_number (added in 0093) needs no new policy — the users table already carries a
-- FOR ALL tenant policy from the initial schema.

ALTER TABLE "outbound_calls" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbound_calls" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "outbound_calls_tenant_isolation" ON "outbound_calls"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
