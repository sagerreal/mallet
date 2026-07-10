-- Add public_token and first_viewed_at to estimates.
-- public_token: unguessable URL-safe token for the customer quote page (no login required).
--   Generated at draft time by the application (32 random bytes, hex-encoded, 64 chars).
-- first_viewed_at: stamped once when the customer first opens the public quote link.
--   Idempotent: the application uses "UPDATE ... WHERE first_viewed_at IS NULL".

ALTER TABLE "estimates" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "first_viewed_at" timestamp with time zone;--> statement-breakpoint

-- Backfill: every existing estimate gets a unique token so the public link works immediately.
-- gen_random_bytes(32) is available in Supabase Postgres via pgcrypto (pre-installed).
-- encode(..., 'hex') produces a 64-character lowercase hex string matching the app's scheme.
UPDATE "estimates"
SET "public_token" = encode(gen_random_bytes(32), 'hex')
WHERE "public_token" IS NULL;--> statement-breakpoint

-- Unique index: tokens must be globally unique across all orgs (enforced on non-null values only).
-- NULLs are not expected after the backfill, but the partial predicate future-proofs the index.
CREATE UNIQUE INDEX "estimates_public_token_uidx" ON "estimates" USING btree ("public_token") WHERE "estimates"."public_token" is not null;
