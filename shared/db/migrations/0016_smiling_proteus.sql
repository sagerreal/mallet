DROP INDEX "outbox_unpublished_idx";--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox" USING btree ("seq") WHERE "outbox"."published_at" is null;