import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import type { Geocoder, GeoPoint } from "../domain/geocoder";

// US Census "onelineaddress" geocoder — free, keyless, US-only. It's the ONLY file talking to the
// Census HTTP API (the port isolates the rest of the app from it). Docs:
// https://geocoding.geo.census.gov/geocoder/  (Public_AR_Current = most recent address ranges).
const CENSUS_BASE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";
const CENSUS_FORMAT = "json";

// Hard ceiling on the round-trip. A geocode is a best-effort side-lookup on a live call — if the
// provider is slow we return null and let the caller proceed rather than stall a booking.
const GEOCODE_TIMEOUT_MS = 3000;

// Census returns matches as { coordinates: { x: <longitude>, y: <latitude> } }. x/y (NOT lat/lng)
// is the trap here — validate the shape, then map y→lat, x→lng below. Extra keys are ignored.
const coordinatesSchema = z.object({ x: z.number(), y: z.number() });
const responseSchema = z.object({
  result: z.object({
    addressMatches: z.array(z.object({ coordinates: coordinatesSchema })),
  }),
});

const normalize = (address: string): string => address.trim().toLowerCase();

const buildUrl = (address: string): string => {
  const params = new URLSearchParams({
    address,
    benchmark: CENSUS_BENCHMARK,
    format: CENSUS_FORMAT,
  });
  return `${CENSUS_BASE_URL}?${params.toString()}`;
};

/**
 * Census-backed {@link Geocoder}. Every failure path (non-200, timeout/abort, JSON parse error,
 * missing/mis-shaped fields, or a thrown fetch) is caught, logged at warn, and collapses to null —
 * this adapter NEVER throws. An in-process cache (keyed by the normalized address) means repeated
 * lookups within a single call don't refetch; misses (null) are cached too so a bad address isn't
 * re-tried. `fetchFn` is injected (defaults to global fetch) so the timeout/parse/cache paths are
 * deterministically unit-testable without hitting the network.
 */
export class CensusGeocoder implements Geocoder {
  private readonly cache = new Map<string, GeoPoint | null>();

  constructor(private readonly fetchFn: typeof fetch = fetch) {}

  async geocode(address: string): Promise<GeoPoint | null> {
    const key = normalize(address);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const point = await this.lookup(address);
    this.cache.set(key, point);
    return point;
  }

  // Single live lookup. Any failure → warn + null (never throws). Kept separate from geocode() so
  // the cache write above happens for both hits and misses regardless of which path we took here.
  private async lookup(address: string): Promise<GeoPoint | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(buildUrl(address), { signal: controller.signal });
      if (!res.ok) {
        logger.warn({ address, status: res.status }, "census.geocode non-200");
        return null;
      }

      const body: unknown = await res.json();
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) {
        logger.warn({ address, reason: "unexpected response shape" }, "census.geocode parse failed");
        return null;
      }

      const first = parsed.data.result.addressMatches[0];
      if (!first) return null; // No match — a normal outcome, not an error.

      // x=longitude, y=latitude — do NOT swap.
      return { lat: first.coordinates.y, lng: first.coordinates.x };
    } catch (e) {
      const reason = controller.signal.aborted
        ? "timeout"
        : e instanceof Error
          ? e.name
          : "unknown";
      logger.warn({ address, reason }, "census.geocode failed");
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
