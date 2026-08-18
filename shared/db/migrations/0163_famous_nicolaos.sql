-- Per-wall square-footage overrides on a room capture: {"<wallIndex>": sqft}.
--
-- "we should be able to edit specific walls on the scan not just the total square feet" — the
-- painter's number for ONE wall, the scanner's for the rest; walls_sqft recomputes as the sum.
--
-- ADDITIVE ONLY (a new column with a default), so no existing row changes meaning. WRITTEN
-- RE-RUNNABLE (guarded, not drizzle's bare ADD) because migration 0163 is CONTESTED: PR #546
-- holds an unapplied 0163 of its own, and whichever branch rebases second regenerates — a
-- re-runnable file survives the renumber dance with zero ledger surgery (the 0156/0157 recipe).

ALTER TABLE "room_captures" ADD COLUMN IF NOT EXISTS "wall_overrides" jsonb NOT NULL DEFAULT '{}';
