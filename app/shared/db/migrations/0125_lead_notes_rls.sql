-- Tenant isolation for the customer activity trail. Same model as site_captures (0123):
-- reuse public.current_org_id() (do NOT redefine), ENABLE + FORCE RLS, FOR ALL policy keyed on
-- org_id, fail-closed when unset. The table carries its own org_id (stamped on insert), so the
-- runtime role (NOBYPASSRLS) can never address another tenant's rows even with blanket DML grants.
--
-- Notes hold free text a customer told the shop — gate codes, access instructions, what a call
-- was about. Cross-tenant leakage here is a disclosure of the customer's own words, so the
-- composite FK on (org_id, lead_id) in 0124 backs this up: a row cannot even reference a lead
-- that belongs to another org.

ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lead_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY lead_notes_tenant_isolation ON public.lead_notes
  FOR ALL
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
