-- TWO CLOCKS, NOT ONE — the shift, and the job it is being spent on.
--
-- 0092 enforced ONE running entry per technician, on the reasoning that "two open segments means
-- the technician is on two clocks at once and their paid hours double-count". That is true of two
-- SHIFT segments. It is not true of a job row, because a job row is not paid time.
--
-- A job row records WHICH JOB part of a shift was spent on: costing, not time tracking. It adds no
-- paid hours and QuickBooks never sees it. So it has to be able to run at the same time as the
-- regular time it describes — a technician is on the clock AND on a job, which is one fact about
-- one hour, not two hours.
--
-- Under the old index that state was illegal, so tapping Arrived had to CLOSE the shift and open a
-- job segment in its place. That made job time a slice of the shift rather than a note about it,
-- which is why attributing three hours of a twelve-hour day collided with the twelve hours by
-- definition and the office could not do it at all.
--
-- The double-count guarantee is not weakened, it is applied per LANE: at most one running shift
-- row, and at most one running job row. Two shift segments is still impossible, which is the thing
-- 0092 existed to stop.
--
-- Not CONCURRENTLY, for the same reason 0092 was not: drizzle runs migrations in a transaction.

DROP INDEX IF EXISTS "time_entries_one_running_per_tech_uidx";

-- The shift lane: regular, break, travel — the segments that pay.
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_one_running_shift_per_tech_uidx"
  ON "time_entries" ("org_id", "tech_user_id")
  WHERE "running" AND "deleted_at" IS NULL AND "kind" <> 'job';

-- The costing lane: at most one job at a time, because a technician is in one place.
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_one_running_job_per_tech_uidx"
  ON "time_entries" ("org_id", "tech_user_id")
  WHERE "running" AND "deleted_at" IS NULL AND "kind" = 'job';
