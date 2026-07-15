import { describe, it, expect } from "vitest";
import { CensusGeocoder } from "./census-geocoder";

// Live integration for the Census geocoder — hits the real (keyless, free) Census API, so it lives
// under the int suite. Unlike the DB int tests it needs no secret, only network; the deterministic
// failure/cache paths are covered in census-geocoder.test.ts.

describe("CensusGeocoder against the live US Census API", () => {
  it("resolves a well-known address to the correct lat/lng (catches an x/y swap)", async () => {
    const geocoder = new CensusGeocoder();

    const point = await geocoder.geocode("1600 Pennsylvania Avenue NW, Washington, DC 20500");

    expect(point).not.toBeNull();
    // The White House is ~(38.90, -77.03). Positive ~38-39 lat, negative ~-77 lng — a swap would
    // flip the signs and blow past these bounds.
    expect(point!.lat).toBeGreaterThan(38.8);
    expect(point!.lat).toBeLessThan(39.0);
    expect(point!.lng).toBeGreaterThan(-77.13);
    expect(point!.lng).toBeLessThan(-76.93);
  });

  it("returns null for an unresolvable address", async () => {
    const geocoder = new CensusGeocoder();

    expect(await geocoder.geocode("zzzzzz not a real address 99999")).toBeNull();
  });
});
