CREATE INDEX "invoices_org_updated_idx" ON "invoices" USING btree ("org_id","updated_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
-- Repair the jobs whose stored total never learned it had been priced.
--
-- jobs.total_cents was written once, at create, and no line write ever moved it (see
-- DrizzleJobRepository.syncTotalFromLines, which is the code fix). So a job priced through the
-- price builder, the field sign-off or the estimate conversion kept a $0 headline while carrying
-- real lines. Money's ready-to-bill rollup sums that column, the `noPrice` view filters on it and
-- the Amount sort orders by it, so all three reported zero on work the shop had already sold.
--
-- SCOPE, deliberately narrow:
--   total_cents = 0   only a job that never got a number is repaired; a stored total that
--                     disagrees with its lines for a legitimate reason — the accepted estimate's
--                     tax-inclusive, possibly discounted figure — is left exactly as it is.
--   sum > 0           a job whose lines genuinely total zero already states the truth. Jobs with
--                     no live lines at all never enter the join.
--
-- The arithmetic is round-per-line, matching lineAmountCents (job-signature.ts), the estimate
-- repository's SQL and the new repository write. Idempotent: after this runs nothing matches it.
UPDATE "jobs" j
SET "total_cents" = priced.sum_cents, "updated_at" = now()
FROM (
  SELECT "job_id", sum(round("quantity" * "rate_cents"))::int AS sum_cents
  FROM "job_lines"
  WHERE "deleted_at" IS NULL
  GROUP BY "job_id"
) priced
WHERE priced."job_id" = j."id"
  AND j."deleted_at" IS NULL
  AND j."total_cents" = 0
  AND priced.sum_cents > 0;
