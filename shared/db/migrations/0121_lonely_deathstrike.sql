-- A quote can now belong to a JOB, which is what a change order is: more work found on site,
-- priced, and put to the customer to agree to. Null on an ordinary quote, which sells work before
-- any job exists.
--
-- The link is what lets an invoice sum EVERY signature that governs a job rather than only the one
-- on the original quote — so an overage warning means genuinely unauthorised, not "the job grew".
--
-- Nullable and additive: every existing quote keeps working untouched.
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "change_order_for_job_id" uuid;
