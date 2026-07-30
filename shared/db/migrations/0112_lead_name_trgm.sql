-- Trigram index on lead names, so the jobs search can match CUSTOMER name.
--
-- The client-side search this replaces covered customer name (jobs-home.tsx built its haystack
-- from custName + title + address). Moving search to the server without it would be a visible
-- regression on the first search someone runs, so the jobs repository matches lead name through
-- an EXISTS subquery — and an EXISTS with ILIKE '%term%' is a sequential scan over every lead in
-- the tenant unless the name column carries a trigram index.
--
-- IF NOT EXISTS: dev and prod share a database, migrations are single-writer, and a
-- partially-applied batch must be safe to re-run.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_name_trgm_idx" ON "leads" USING gin ("name" gin_trgm_ops);
