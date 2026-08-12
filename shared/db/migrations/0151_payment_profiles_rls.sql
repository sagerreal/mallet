-- Tenant isolation for the card-on-file pointers. Same model as estimate_deposits (0136) /
-- lead_notes (0125): reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS,
-- FOR ALL policy keyed on org_id, fail-closed when unset. drizzle-kit does not emit RLS, so
-- 0150 created the table WITHOUT it — this file is the half that makes it safe to hold
-- payment pointers.
--
-- The row is two Stripe pointers (cus_…, pm_…) plus brand/last4. A cross-tenant READ would
-- disclose which of another shop's customers keep a card on file (and its last4); a
-- cross-tenant WRITE would be worse — it could point one shop's "Charge card on file" button
-- at another shop's saved customer. The composite FK on (org_id, lead_id) from 0150 backs
-- this up: a profile row cannot even reference a customer belonging to another org.
--
-- The runtime role is NOBYPASSRLS, so with FORCE enabled these policies bind even for the
-- table owner path used by migrations-adjacent tooling.

ALTER TABLE public.payment_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.payment_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY payment_profiles_tenant_isolation ON public.payment_profiles
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
