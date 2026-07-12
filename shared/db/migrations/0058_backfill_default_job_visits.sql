-- Data-only backfill: seed one unplaced default-length visit (120 min, pending, position 1)
-- onto every active scheduled job that has no active visit. Jobs auto-created from an accepted
-- quote used to start with zero visits, so the job modal showed only "Not scheduled yet." (no
-- editable Length row) and the schedule tray's "2h" was a display fallback rather than real data.
-- From this release CreateJobFromEstimateUseCase seeds the visit at creation; this brings
-- existing rows in line. Runs as the table owner (BYPASSRLS), so it sees all tenants; org_id is
-- copied from the job so RLS isolation holds for the new rows.
INSERT INTO public.job_visits
  (id, org_id, job_id, duration_minutes, status, position, created_at, updated_at)
SELECT gen_random_uuid(), j.org_id, j.id, 120, 'pending', 1, now(), now()
FROM public.jobs j
WHERE j.deleted_at IS NULL
  AND j.status = 'scheduled'
  AND NOT EXISTS (
    SELECT 1
    FROM public.job_visits v
    WHERE v.org_id = j.org_id
      AND v.job_id = j.id
      AND v.deleted_at IS NULL
  );
