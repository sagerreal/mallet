// PURE service-area math + a NON-THROWING service-area check. Split from the tools so the great-
// circle distance and the in/out/unknown decision are testable in isolation (many-small-files house
// rule) and reusable by both check_availability (early bail) and book_visit (authoritative check).
//
// GRACEFUL DEGRADE is the load-bearing contract: whenever we CAN'T be sure a caller is out of area
// (no configured origin, a non-positive radius, or a geocode miss) the result is "unknown" and the
// caller proceeds to book as before — a service-area check must NEVER block a booking on missing or
// flaky geocoding. Only a CONFIDENT out-of-area (geocoded point measurably beyond the radius) declines.
import { logger } from "@mallet/shared/observability";
import type { Geocoder, GeoPoint } from "../domain/geocoder";

// Mean Earth radius in miles (WGS84 mean) — the haversine scale factor. Named so the constant isn't
// a magic number buried in the formula.
export const EARTH_RADIUS_MI = 3958.8;

// Degrees → radians for the trig below.
const DEG_TO_RAD = Math.PI / 180;
const toRadians = (deg: number): number => deg * DEG_TO_RAD;

/**
 * Great-circle distance between two points in MILES (haversine). Pure and symmetric. Uses the mean
 * Earth radius — accurate to well within the tolerance a service-area radius needs (a few miles).
 */
export const haversineMiles = (a: GeoPoint, b: GeoPoint): number => {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_MI * c;
};

// The three outcomes. "unknown" is the SAFE-TO-BOOK degrade result (no origin, bad radius, or a
// geocode miss) — callers treat it exactly like "in" and proceed. Only "out" declines a booking.
export type AreaCheck = "in" | "out" | "unknown";

// The result of a service-area check. `point` is the geocoded caller address when we resolved one,
// exposed so a later proximity step (Phase 2) can reuse it WITHOUT geocoding the same address twice.
// It is null on every "unknown" path (no origin / bad radius / geocode miss) — there is no point to
// reuse in those cases.
export interface ServiceAreaResult {
  readonly check: AreaCheck;
  readonly point: GeoPoint | null;
}

// Frozen so a returned result can't be mutated by a caller (immutability house rule).
const result = (check: AreaCheck, point: GeoPoint | null): ServiceAreaResult =>
  Object.freeze({ check, point });

const UNKNOWN: ServiceAreaResult = result("unknown", null);

/**
 * Decide whether a free-text address is inside the org's service area. NEVER throws.
 *
 * Degrades to "unknown" (→ book normally) when we can't be confident:
 *   - `origin` is null (the shop hasn't set/geocoded a service origin), OR
 *   - `radiusMi <= 0` (no meaningful radius configured), OR
 *   - the address doesn't geocode (bad address, provider down/slow — the Geocoder returns null).
 *
 * Otherwise it geocodes the address once and compares the great-circle distance to the radius:
 * `distance <= radiusMi` → "in", else "out". The geocoded point rides back on the result so a
 * downstream step doesn't re-geocode.
 */
export const isInServiceArea = async (
  address: string,
  origin: GeoPoint | null,
  radiusMi: number,
  geocoder: Geocoder,
): Promise<ServiceAreaResult> => {
  // No origin or no meaningful radius → we can't measure anything. Degrade to book-normally.
  if (origin === null || !(radiusMi > 0)) return UNKNOWN;

  // The Geocoder port never throws (a miss is null); guard defensively anyway so this function's
  // never-throws contract holds even if a future adapter breaks that promise.
  let point: GeoPoint | null = null;
  try {
    point = await geocoder.geocode(address);
  } catch (error: unknown) {
    logger.warn(
      { reason: error instanceof Error ? error.message : "unknown" },
      "frontdesk.service_area.geocode_threw",
    );
    return UNKNOWN;
  }

  // Couldn't resolve the address → don't guess it's out; degrade to book-normally.
  if (point === null) return UNKNOWN;

  const distanceMi = haversineMiles(point, origin);
  return result(distanceMi <= radiusMi ? "in" : "out", point);
};
