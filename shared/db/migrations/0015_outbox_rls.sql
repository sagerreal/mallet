-- Tenant isolation for the outbox. Reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE
-- RLS, one FOR ALL policy keyed on org_id, fail-closed when unset. Mirror 0013_notifications_rls.sql.
--
-- Note: the WRITE path (OutboxEventBus, inside withTenant) is scoped by this policy — an org can only
-- write its own events. The background relay reads via the BYPASSRLS owner connection (a trusted
-- system process, NOT a tenant request) and re-scopes each dispatch with withTenant(org_id); this is
-- the single sanctioned non-RLS read path, exactly like migrations.

ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.outbox FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY outbox_tenant_isolation ON public.outbox
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
