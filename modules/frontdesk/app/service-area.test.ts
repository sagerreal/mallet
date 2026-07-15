import { describe, it, expect } from "vitest";
import { haversineMiles, isInServiceArea, EARTH_RADIUS_MI } from "./service-area";
import type { Geocoder, GeoPoint } from "../domain/geocoder";

// Pure math + the non-throwing in/out/unknown decision. No I/O — the geocoder is a fake that returns
// a fixed point, a miss (null), or throws, so every branch is deterministic.

// A geocoder pinned to one point for any address (never throws).
const fixed = (point: GeoPoint): Geocoder => ({ async geocode() { return point; } });
// A geocoder that always misses.
const missing: Geocoder = { async geocode() { return null; } };
// A geocoder that throws (defensive path — the real port never throws, but the check must not either).
const throwing: Geocoder = {
  async geocode() {
    throw new Error("provider exploded");
  },
};

const SF: GeoPoint = { lat: 37.7749, lng: -122.4194 };
const LA: GeoPoint = { lat: 34.0522, lng: -118.2437 };

describe("haversineMiles", () => {
  it("computes SF↔LA great-circle distance ≈ 347 mi (±5)", () => {
    const d = haversineMiles(SF, LA);
    expect(d).toBeGreaterThan(342);
    expect(d).toBeLessThan(352);
  });

  it("is zero for identical points", () => {
    expect(haversineMiles(SF, SF)).toBeCloseTo(0, 6);
  });

  it("is symmetric (a→b === b→a)", () => {
    expect(haversineMiles(SF, LA)).toBeCloseTo(haversineMiles(LA, SF), 9);
  });

  it("exposes the mean Earth radius constant used as the scale factor", () => {
    expect(EARTH_RADIUS_MI).toBe(3958.8);
  });
});

describe("isInServiceArea", () => {
  it('in-radius address → "in", carries the geocoded point back', async () => {
    // ~5 mi north of SF, radius 25 → in.
    const near: GeoPoint = { lat: 37.85, lng: -122.42 };
    const res = await isInServiceArea("near st", SF, 25, fixed(near));
    expect(res.check).toBe("in");
    expect(res.point).toEqual(near);
  });

  it('just-outside the radius → "out"', async () => {
    // LA is ~347 mi from SF; radius 25 → out.
    const res = await isInServiceArea("la address", SF, 25, fixed(LA));
    expect(res.check).toBe("out");
    // the point still rides back (reusable) even on an out result
    expect(res.point).toEqual(LA);
  });

  it('null origin → "unknown" (degrade to book), no point', async () => {
    const res = await isInServiceArea("anywhere", null, 25, fixed(LA));
    expect(res.check).toBe("unknown");
    expect(res.point).toBeNull();
  });

  it('radius 0 → "unknown" (no meaningful radius configured)', async () => {
    const res = await isInServiceArea("anywhere", SF, 0, fixed(SF));
    expect(res.check).toBe("unknown");
    expect(res.point).toBeNull();
  });

  it('negative radius → "unknown"', async () => {
    const res = await isInServiceArea("anywhere", SF, -5, fixed(SF));
    expect(res.check).toBe("unknown");
  });

  it('geocode miss (null) → "unknown" (don\'t guess out-of-area)', async () => {
    const res = await isInServiceArea("gibberish", SF, 25, missing);
    expect(res.check).toBe("unknown");
    expect(res.point).toBeNull();
  });

  it('a thrown geocoder → "unknown" (never propagates the throw)', async () => {
    const res = await isInServiceArea("anywhere", SF, 25, throwing);
    expect(res.check).toBe("unknown");
    expect(res.point).toBeNull();
  });

  it("distance exactly on the radius counts as in (<= boundary)", async () => {
    // A point ~10 mi from SF with radius set to exactly that distance → in.
    const p: GeoPoint = { lat: 37.9198, lng: -122.4194 }; // ~10 mi due north
    const exact = haversineMiles(p, SF);
    const res = await isInServiceArea("edge", SF, exact, fixed(p));
    expect(res.check).toBe("in");
  });

  it("returns a frozen result (immutable)", async () => {
    const res = await isInServiceArea("x", null, 25, missing);
    expect(Object.isFrozen(res)).toBe(true);
  });
});
