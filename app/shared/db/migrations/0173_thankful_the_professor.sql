-- A job attachment can be a document, not only a photo.
--
-- WHY. Photos already uploaded; a spec sheet, a permit, a supplier receipt did not, so anything
-- that was not an image had no home on a job at all. job_photos already carries a CAPTION, which
-- is the useful half of "attach a file to a note" — the file and the sentence explaining it — so
-- widening this table beats giving notes their own identity. Job notes are a text blob appended
-- line by line (job.notes); there is nothing there to attach to.
--
-- BOTH COLUMNS NULLABLE, and null means "photo". Every existing row is an image: the upload input
-- enum only ever admitted jpg/jpeg/png/webp. So a null mime_type reads as an image rather than as
-- unknown, and no backfill is needed.
--
-- Written re-runnable per the established convention — the database is shared across branches.

DO $$ BEGIN
  ALTER TABLE "job_photos" ADD COLUMN "mime_type" text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "job_photos" ADD COLUMN "file_name" text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;