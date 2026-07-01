-- RLS for tool_confirmations (mirrors the outbox tenant policy, 0015).
--
-- Rows are only ever read/written inside withTenant(principal.orgId) — a proposal is minted in the
-- proposing key's org and can only be consumed there. FORCE RLS means even a leaked raw token is
-- useless from another tenant: the consuming UPDATE simply matches zero rows. No SECURITY DEFINER
-- function is needed (unlike api_keys) because the org is always known before any lookup.

ALTER TABLE public.tool_confirmations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tool_confirmations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tool_confirmations_tenant_isolation ON public.tool_confirmations
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
