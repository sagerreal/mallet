-- Tenant isolation for qbo_connections. Same model as a2p_registrations (0085), frontdesk_calls
-- (0071), quoting_rules (0069), pricebook_materials (0065) and inbound_endpoints (0059): reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id,
-- fail-closed when unset.
--
-- This table holds the sealed OAuth tokens for a shop's QuickBooks company. A cross-tenant read
-- here would hand one shop the keys to another shop's accounting system, so FORCE matters: it
-- applies the policy to the table owner too, not just to ordinary roles.

ALTER TABLE "qbo_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "qbo_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "qbo_connections_tenant_isolation" ON "qbo_connections"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
