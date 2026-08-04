-- Tenant isolation for the quote-deposit ledger. Same model as payments / lead_notes (0125):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. drizzle-kit does not emit RLS, so 0135 created the table
-- WITHOUT it — this file is the half that makes the table safe to hold money.
--
-- This ledger is the record of what a customer actually paid, and dep_paid_cents is DERIVED from
-- it (SUM of amount_cents). A cross-tenant read here would disclose another shop's collected
-- revenue; a cross-tenant write would credit one shop's quote with another's money and flow
-- straight through to an invoice balance. The composite FK on (org_id, estimate_id) from 0135
-- backs this up: a row cannot even reference an estimate belonging to another org.
--
-- The runtime role is NOBYPASSRLS, so with FORCE enabled these policies bind even for the table
-- owner path used by migrations-adjacent tooling.

ALTER TABLE public.estimate_deposits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.estimate_deposits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY estimate_deposits_tenant_isolation ON public.estimate_deposits
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
