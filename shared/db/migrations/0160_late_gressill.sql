-- Wall area a room does NOT get painted, selected by tap on the scan already taken.
--
-- WHY IT EXISTS. walls_sqft is reported GROSS on purpose (derive-painting.ts: openings are never
-- deducted, because you cut in around a window and the cutting is the cost). Tile is the opposite —
-- a band nobody paints and nobody cuts around. The only lever before this was overriding
-- walls_sqft with a hand-worked number, which lost the REASON: six weeks later nobody could tell
-- tile from a mistake from a discount. A deduction keeps it, so an estimate shows its arithmetic.
--
-- INPUTS ONLY. wall_indexes + height_m are what the painter chose; the square footage is derived
-- server-side from the capture's geometry on every read, never trusted from the client — the same
-- law as site_captures.area_sqft. A re-scan therefore re-derives instead of pricing a stale number.
--
-- WRITTEN RE-RUNNABLE, and this one is not theoretical: this table was first generated as 0159 and
-- applied to the shared database before #536 landed its own 0159 (the soffit constraint widening).
-- Renumbering here changes the file's hash, so drizzle will offer it again against a database that
-- already has the table. Each step is guarded so applying it twice converges instead of erroring —
-- the same shape as 0156/0157/0159.

CREATE TABLE IF NOT EXISTS "room_deductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"capture_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"kind" text NOT NULL,
	"wall_indexes" jsonb NOT NULL,
	"height_m" numeric(8, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "room_deductions_org_id_uq" UNIQUE("org_id","id"),
	CONSTRAINT "room_deductions_kind_ck" CHECK ("room_deductions"."kind" in ('whole_wall','band')),
	CONSTRAINT "room_deductions_height_ck" CHECK (("room_deductions"."kind" = 'whole_wall' and "room_deductions"."height_m" is null) or ("room_deductions"."kind" = 'band' and "room_deductions"."height_m" > 0)),
	CONSTRAINT "room_deductions_reason_ck" CHECK (length(btrim("room_deductions"."reason")) between 1 and 60)
);
--> statement-breakpoint
-- ADD CONSTRAINT has no IF NOT EXISTS; duplicate_object is the second-run path.
DO $$ BEGIN
  ALTER TABLE "room_deductions" ADD CONSTRAINT "room_deductions_capture_fk"
    FOREIGN KEY ("org_id","capture_id") REFERENCES "public"."room_captures"("org_id","id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_deductions_org_capture_idx" ON "room_deductions" USING btree ("org_id","capture_id","deleted_at");
