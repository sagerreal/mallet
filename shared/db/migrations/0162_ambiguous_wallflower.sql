-- Trim height: the number that turns a run into an area.
--
-- Hand-rewritten from drizzle's emit to be RE-RUNNABLE, and here that is load-bearing rather than
-- hygiene. This started life as 0160; two other branches took 0160 and 0161 while it was in
-- review, so it was renumbered — which changes the file hash, which is the identity drizzle keys
-- `__drizzle_migrations` on. The shared dev/prod database has ALREADY had these statements applied
-- under the old number, so this file WILL run a second time against a database that already has
-- the column and both constraints. Every statement below therefore has to survive that.

-- 1. The height itself. Nullable by design: null is "nobody has said how tall the trim is", which
--    is why the room offers a length and not an area. Backfilling a default would be inventing a
--    measurement.
ALTER TABLE "painting_room_quantities" ADD COLUMN IF NOT EXISTS "height_in" numeric(6, 2);
--> statement-breakpoint

-- 2. A height only exists on a RUN, and only at a size that is really trim.
--    Zero is excluded deliberately: "this room has no baseboard" is a confirmed zero RUN (the
--    None control), not a zero-height one — a zero here would price 38 feet of real base at
--    nothing. Above 24" it is wainscot or panelling, which is a wall surface, and much likelier
--    a slip for 3.6.
ALTER TABLE "painting_room_quantities" DROP CONSTRAINT IF EXISTS "painting_room_quantities_height_ck";
--> statement-breakpoint
ALTER TABLE "painting_room_quantities" ADD CONSTRAINT "painting_room_quantities_height_ck"
  CHECK (
    "painting_room_quantities"."height_in" is null
    or (
      "painting_room_quantities"."kind" in ('baseboard_lnft','crown_lnft')
      and "painting_room_quantities"."height_in" > 0
      and "painting_room_quantities"."height_in" <= 24
    )
  );
--> statement-breakpoint

-- 3. Widen measured_by for the two trim AREAS a run turns into once its height is known, so a
--    shop that bids trim by the square foot can point a pricebook service at one.
--
--    ORDER MATTERS: this widening must land BEFORE the app code that can write 'baseboard_sqft'
--    deploys, or the insert is rejected by the old constraint. Widening is additive and every
--    pre-existing value stays legal, so applying it early is safe on its own.
ALTER TABLE "pricebook_items" DROP CONSTRAINT IF EXISTS "pricebook_items_measured_by_check";
--> statement-breakpoint
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_measured_by_check"
  CHECK (
    "pricebook_items"."measured_by" is null
    or "pricebook_items"."measured_by" in (
      'hour',
      'walls_sqft', 'ceiling_sqft', 'soffit_sqft',
      'baseboard_lnft', 'baseboard_sqft',
      'crown_lnft', 'crown_sqft',
      'doors_count', 'windows_count',
      'site_sqft', 'site_lnft'
    )
  );
