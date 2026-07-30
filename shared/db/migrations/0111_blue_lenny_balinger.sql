-- Indexes backing the named job sorts (modules/jobs/infra/job-sorts.ts) and server-side search.
--
-- IF NOT EXISTS throughout: dev and prod are the same database and migrations are single-writer,
-- so a partially-applied batch must be safe to re-run rather than abort and leave the journal
-- claiming it ran.
--
-- Plain CREATE INDEX, not CONCURRENTLY: drizzle runs migrations inside a transaction and
-- CONCURRENTLY cannot. At current row counts the lock is milliseconds. If a tenant ever reaches
-- the millions, these want rebuilding out-of-band with CONCURRENTLY instead.
--
-- No RLS changes needed — policies apply to rows, not indexes.

-- Column order mirrors the ORDER BY exactly (org, sort column, id tiebreaker). NULLS LAST matches
-- orderFor() in shared/db/sort-page.ts; if the two ever disagree the planner silently stops using
-- the index and the query looks fine while doing a sequential scan.
CREATE INDEX IF NOT EXISTS "jobs_org_scheduled_idx" ON "jobs" USING btree ("org_id","scheduled_start" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_org_total_idx" ON "jobs" USING btree ("org_id","total_cents" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_org_status_scheduled_idx" ON "jobs" USING btree ("org_id","status","scheduled_start" DESC NULLS LAST);--> statement-breakpoint

-- Search. A btree index cannot serve `ILIKE '%term%'` at all — the leading wildcard makes it
-- unusable — so without trigram this is a sequential scan of every job in the tenant on every
-- keystroke. pg_trgm + GIN is what makes an infix search indexable.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_title_trgm_idx" ON "jobs" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_num_trgm_idx" ON "jobs" USING gin ("num" gin_trgm_ops);
