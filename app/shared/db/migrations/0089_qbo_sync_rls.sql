-- Tenant isolation for qbo_entity_links and qbo_sync_log. Same model as qbo_connections (0087),
-- a2p_registrations (0085), frontdesk_calls (0071): reuse public.current_org_id() (do NOT
-- redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on org_id, fail-closed when unset.
--
-- qbo_entity_links maps Mallet people to QuickBooks employee records; qbo_sync_log records what was
-- pushed to whose books. Both are per-tenant business data and neither may cross an org boundary.

ALTER TABLE "qbo_entity_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "qbo_entity_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "qbo_entity_links_tenant_isolation" ON "qbo_entity_links"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
--> statement-breakpoint

ALTER TABLE "qbo_sync_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "qbo_sync_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "qbo_sync_log_tenant_isolation" ON "qbo_sync_log"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
