-- Migration 0082: audit-hardening indexes (additive, no data changes)
-- Index 1: job_visits by org + scheduled_date for the schedule board query
CREATE INDEX IF NOT EXISTS job_visits_org_date_idx ON job_visits (org_id, scheduled_date);

-- Index 2: callback jobs (org_id) partial index — rows where callback_of IS NOT NULL
-- but callback_reason IS NULL (data-integrity sentinel: a rework without a reason).
CREATE INDEX IF NOT EXISTS jobs_org_callback_unclassified_idx
  ON jobs (org_id)
  WHERE callback_reason IS NULL AND callback_of IS NOT NULL;
