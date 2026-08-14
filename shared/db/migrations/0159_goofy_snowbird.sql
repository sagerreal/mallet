-- Widen two CHECK constraints to admit a new painting quantity: soffit_sqft.
--
-- WHY IT EXISTS. RoomPlan models walls, the floor and openings. A boxed soffit (a bulkhead over a
-- doorway, around a kitchen, hiding ductwork) is none of those, so neither its vertical faces nor
-- its underside arrive in the scan payload at all — a real doctor's-office scan came back 400.4
-- sqft of wall with the soffit simply absent. It is not a tuning problem: the geometry is outside
-- what the sensor reports. So it is the painter's number, entered once, and it prices at its own
-- rate because a soffit is slower than open wall (two planes, cut in on both edges).
--
-- WIDENING ONLY. Every value that was legal before is still legal, so no existing row can be
-- invalidated by this and no backfill is needed.
--
-- WRITTEN RE-RUNNABLE. Drizzle emits a bare DROP + ADD, which fails on a second run (and on a
-- branch that lands after another has already applied the DDL). Each step is guarded so applying
-- this twice converges instead of erroring — the same shape as 0156/0157.

DO $$ BEGIN
  ALTER TABLE "pricebook_items" DROP CONSTRAINT IF EXISTS "pricebook_items_measured_by_check";
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_measured_by_check"
    CHECK ("pricebook_items"."measured_by" is null or "pricebook_items"."measured_by" in (
      'hour', 'walls_sqft', 'ceiling_sqft', 'soffit_sqft', 'baseboard_lnft', 'crown_lnft',
      'doors_count', 'windows_count', 'site_sqft', 'site_lnft'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "painting_room_quantities" DROP CONSTRAINT IF EXISTS "painting_room_quantities_kind_ck";
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "painting_room_quantities" ADD CONSTRAINT "painting_room_quantities_kind_ck"
    CHECK ("painting_room_quantities"."kind" in (
      'walls_sqft','ceiling_sqft','soffit_sqft','baseboard_lnft','crown_lnft','doors_count','windows_count'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
