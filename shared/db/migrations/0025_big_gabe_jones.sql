ALTER TABLE "users" ADD COLUMN "is_field_crew" boolean DEFAULT false NOT NULL;

-- Backfill: owner and tech are schedulable field crew; office is not.
UPDATE "users" SET "is_field_crew" = true WHERE "role" IN ('owner', 'tech');