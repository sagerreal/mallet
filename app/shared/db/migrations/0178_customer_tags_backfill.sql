-- Carry the office's hand-picked lead-source labels over to `leads.tags`.
--
-- The old "Lead source" picker collected two unrelated kinds of value into one column: labels an
-- office chose ("Google", "Referral", "Repeat customer", "Nextdoor", "Yelp") and provenance the
-- SYSTEM wrote ("Added manually", "Import", "web", "Website", "AI Front Desk"). On the live book
-- that split was 21 chosen vs 162 machine-written out of 183 populated rows.
--
-- Only the chosen labels become tags. Tagging 122 customers "Added manually" would fill a brand
-- new feature with noise on day one, and the provenance is not lost — it stays in `leads.source`,
-- which is still what the front desk and the importer write and what the composer's draft-run
-- reads to name a request.
--
-- Guarded on `tags = '{}'` so the statement is re-runnable and never overwrites a tag set an
-- office has since edited by hand.

UPDATE "leads"
SET "tags" = ARRAY["source"], "updated_at" = now()
WHERE "deleted_at" IS NULL
  AND "source" IS NOT NULL
  AND "tags" = '{}'::text[]
  AND "source" NOT IN ('Added manually', 'Import', 'web', 'Website', 'AI Front Desk');
