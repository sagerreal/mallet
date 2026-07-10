ALTER TABLE "estimates" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "estimates" ADD COLUMN "first_viewed_at" timestamp with time zone;--> statement-breakpoint
-- Backfill: every existing estimate gets a unique token so its public link works immediately.
-- gen_random_bytes(32) comes from pgcrypto (pre-installed on Supabase); encode(...,'hex') yields a
-- 64-char lowercase hex string matching the app's draft-time scheme. Runs BEFORE the unique index
-- so all rows are non-null and covered by it.
UPDATE "estimates" SET "public_token" = encode(gen_random_bytes(32), 'hex') WHERE "public_token" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "estimates_public_token_uidx" ON "estimates" USING btree ("public_token") WHERE "estimates"."public_token" is not null;