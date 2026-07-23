-- Tenant isolation for a2p_registrations. Same model as frontdesk_calls (0071),
-- quoting_rules (0069), pricebook_categories (0063), pricebook_materials (0065), and
-- inbound_endpoints (0059): reuse public.current_org_id() (do NOT redefine), ENABLE +
-- FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset.

ALTER TABLE "a2p_registrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "a2p_registrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "a2p_registrations_tenant_isolation" ON "a2p_registrations"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
