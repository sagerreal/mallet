-- Trigram indexes on the JOB columns the jobs search actually matches.
--
-- Phase 2 of the server-side-lists plan called for "pg_trgm GIN indexes on the searched text
-- columns". Leads got them (0111, 0112); jobs did not, and the miss was invisible because the
-- seeded org is small enough that a sequential scan looks instant.
--
-- Measured at the plan's own success criterion — 40,000 jobs, via scripts/scale-benchmark.mjs —
-- the jobs search was the slowest query in the whole application at ~89 ms and the only one
-- anywhere near a user-visible delay. `ILIKE '%term%'` cannot use a btree index at all, so this is
-- the difference between an index scan and reading every job in the tenant on every keystroke.
--
-- Both columns, because the repository ORs them: title is what people search, num is what they
-- paste out of an invoice or a text message.
--
-- IF NOT EXISTS throughout: dev and prod share a database, this was already applied under an
-- earlier number (0116) before #306 took that slot, and a re-run must be a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_num_trgm_idx" ON "jobs" USING gin ("num" gin_trgm_ops);
