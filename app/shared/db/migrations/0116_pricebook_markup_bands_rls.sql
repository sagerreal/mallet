-- Tenant isolation for pricebook_markup_bands (the org's cost-banded parts-markup table).
-- Same model as staff_sms_sessions (0102) and every org-scoped table: reuse
-- public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. Markup bands are pricing strategy — a cross-tenant read
-- would hand one shop a competitor's margin structure.
ALTER TABLE "pricebook_markup_bands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pricebook_markup_bands" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pricebook_markup_bands_tenant_isolation" ON "pricebook_markup_bands"
  FOR ALL
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());
