-- Backs the estimates `sent` sort. Without it, ordering by sent_at is a sequential scan over the
-- whole tenant — fine at a few hundred quotes, a timeout at forty thousand.
--
-- IF NOT EXISTS, added by hand to drizzle's output: dev and prod share one database and this index
-- was already applied under an earlier number (0115) before #306 took that slot. Re-running must be
-- a no-op rather than an error. Same reasoning as 0111/0112.
CREATE INDEX IF NOT EXISTS "estimates_org_sent_idx" ON "estimates" USING btree ("org_id","sent_at" DESC NULLS LAST,"id" DESC NULLS LAST);
