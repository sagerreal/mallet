-- 'hour' joins the service priced-by kinds: an hourly service (expert paver @ $150/hr)
-- is a first-class pricebook row, not a Defaults-rail secret. Constraint swap is the
-- only path (the applied CHECK is immutable); guarded for the shared dev/prod DB.
ALTER TABLE "pricebook_items" DROP CONSTRAINT IF EXISTS "pricebook_items_measured_by_check";
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_measured_by_check"
  CHECK ("measured_by" is null or "measured_by" in ('hour', 'walls_sqft', 'ceiling_sqft', 'baseboard_lnft', 'crown_lnft', 'doors_count', 'windows_count'));
