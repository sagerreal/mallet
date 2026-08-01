-- 'site_sqft'/'site_lnft' join the service priced-by kinds: a traced outdoor surface
-- (aerial takeoff) prices a per-sqft/per-lnft service the way a scanned room prices a
-- painting one. Constraint swap is the only path (the applied CHECK is immutable);
-- guarded for the shared dev/prod DB — mirrors 0120_priced_by_hour.sql.
ALTER TABLE "pricebook_items" DROP CONSTRAINT IF EXISTS "pricebook_items_measured_by_check";
ALTER TABLE "pricebook_items" ADD CONSTRAINT "pricebook_items_measured_by_check"
  CHECK ("measured_by" is null or "measured_by" in ('hour', 'walls_sqft', 'ceiling_sqft', 'baseboard_lnft', 'crown_lnft', 'doors_count', 'windows_count', 'site_sqft', 'site_lnft'));
