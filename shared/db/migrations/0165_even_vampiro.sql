-- Which processor a shop takes cards through.
--
-- WHY IT EXISTS. A shop already running Square will not change processors to change software: the
-- reader is on their counter and their money already lands in that account. The payment PORTS are
-- already provider-neutral (modules/invoicing/domain/{payment-link,card-charge,payment}-gateway.ts,
-- and settings' ConnectGateway) — Stripe is an adapter, not the architecture. This column selects
-- the adapter behind those ports, per org.
--
-- DEFAULT 'stripe' AND NOT NULL. Every existing org is on Stripe, so the backfill is the default
-- and no row changes meaning. "No processor connected" is already said by
-- stripe_connected_account_id being null; this column answers a different question.
--
-- The check constraint is deliberate: this value decides where a shop's money goes, and a typo'd
-- provider must not be storable at all.
--
-- WRITTEN RE-RUNNABLE. This was first generated as 0163 and applied to the shared database before
-- main landed its own 0163 — renumbering changes the file hash, so drizzle offers it again against
-- a database that already has the column. Same convention as 0156/0157/0159/0160.

DO $$ BEGIN
  ALTER TABLE "org_settings" ADD COLUMN "payment_provider" text DEFAULT 'stripe' NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_payment_provider_ck" CHECK ("org_settings"."payment_provider" in ('stripe','square'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;