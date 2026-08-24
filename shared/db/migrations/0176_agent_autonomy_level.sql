-- How much a shop lets Artie (the AI employee) do without asking a human first. See
-- modules/agent-tasks/domain/autonomy.ts for the policy this column feeds: money and
-- destructive tools never auto-approve at any level, regardless of what is stored here — that
-- invariant lives in code, not data, on purpose.
--
-- DEFAULT 'supervised' AND NOT NULL. Every existing shop keeps asking-before-acting until an
-- owner opts up, and a shop that never opens Settings must read the SAME value as one that
-- explicitly chose the most conservative level (see DrizzleSettingsRepository.getAgentAutonomy's
-- no-lazy-create fallback, which mirrors this same default rather than trusting an absent row).
--
-- The check constraint is deliberate, same as org_settings_payment_provider_ck (0165): this value
-- decides what the assistant may do to a customer or their money without a human, and a typo'd
-- level must not be storable at all.
--
-- WRITTEN IDEMPOTENT/RE-RUNNABLE, same convention as 0156/0157/0159/0160/0163/0165: a hand-written
-- migration on a shared dev/prod database can be offered again against a database that already
-- has the column (a renumbered or re-applied file must not fail).

DO $$ BEGIN
  ALTER TABLE "org_settings" ADD COLUMN "agent_autonomy" text DEFAULT 'supervised' NOT NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "org_settings" ADD CONSTRAINT "org_settings_agent_autonomy_ck" CHECK ("org_settings"."agent_autonomy" in ('supervised','assisted','autonomous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
