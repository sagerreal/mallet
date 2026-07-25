-- ONE running clock per technician, enforced by the database.
--
-- The whole capture model rests on this invariant: a tap closes the open segment and opens the
-- next, so two open segments means the technician is on two clocks at once and their paid hours
-- double-count. Until now "two running timers" was a perfectly legal database state — nothing but
-- application code stopped it, and a retried request or two devices could produce it.
--
-- Partial, so it only constrains what is actually running: any number of FINISHED entries may
-- coexist for a tech on a day (that is the normal case — shop, travel, job, break), and
-- soft-deleted rows are excluded so removing an entry frees the slot.
--
-- Concurrency note: this is deliberately NOT `CONCURRENTLY`. drizzle runs migrations inside a
-- transaction, where CONCURRENTLY is not permitted, and time_entries is small enough at this scale
-- that the brief lock is not worth a hand-run migration.
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_one_running_per_tech_uidx"
  ON "time_entries" ("org_id", "tech_user_id")
  WHERE "running" AND "deleted_at" IS NULL;
