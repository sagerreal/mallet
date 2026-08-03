-- Migration 0132: the index behind the Jobs list's WHEN sort (additive, no data changes).
--
-- The WHEN sort used to order on jobs.scheduled_start, which nothing writes — 1,528 jobs in the
-- pilot org, zero with a value — so the list was ordered by nothing and effectively random. It now
-- orders on the date the column actually displays: min(scheduled_date) over the job's LIVE visits
-- (see modules/jobs/infra/job-sorts.ts, nextActiveVisitDate).
--
-- That is a correlated subquery evaluated once per job, so it needs to be an index-only scan or
-- the sort turns into 1,528 heap lookups. The leading (org_id, job_id) matches the correlation and
-- scheduled_date rides along as the payload min() reads.
--
-- PARTIAL, matching the subquery's predicate exactly. Postgres only uses a partial index when the
-- query's WHERE implies the index predicate, so `status <> 'canceled' AND deleted_at IS NULL` has
-- to be written the same way in both places. It also keeps the index off dead and canceled visits,
-- which the sort never reads.
--
-- NOT CONCURRENTLY, deliberately: drizzle runs each migration inside a transaction and CREATE INDEX
-- CONCURRENTLY cannot run in one. The table holds 1,772 rows across every tenant, so the ACCESS
-- SHARE lock is held for single-digit milliseconds — far below anything a request would notice.
-- Revisit if job_visits ever reaches six figures.
--
-- IF NOT EXISTS so a re-apply against the shared live database is a no-op rather than an error.
CREATE INDEX IF NOT EXISTS job_visits_org_job_date_idx
  ON job_visits (org_id, job_id, scheduled_date)
  WHERE deleted_at IS NULL AND status <> 'canceled';
