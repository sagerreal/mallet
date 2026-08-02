/**
 * features/measurements/aerial/use-tracer-map.seed.test.ts
 *
 * The tracer map's view-seeding precedence (seedPlan — pure, no google):
 * saved view → seed coordinates (Places autocomplete's Place Details) →
 * geocode the address → no-address. The "location" branch is the fix for the
 * founder's held-mode failure: an autocomplete-selected address must pan the
 * map from its own coordinates, with NO Geocoding API call (the org key had
 * Places enabled but geocoding rejected, so the re-geocode of the committed
 * string failed with "Couldn't find … on the map").
 */
import { describe, it, expect } from "vitest";
import { seedPlan } from "./use-tracer-map";

const savedView = { centerLat: 42.2, centerLng: -70.9, zoom: 20 };
const location = { lat: 42.2205, lng: -70.9403 };

describe("seedPlan", () => {
  it("a saved capture's view wins over everything", () => {
    expect(seedPlan(savedView, location, "286 Pine Street, Weymouth, MA, USA")).toEqual({
      kind: "saved",
    });
  });

  it("seed coordinates pan the map directly — no geocode call for an autocomplete pick", () => {
    expect(seedPlan(null, location, "286 Pine Street, Weymouth, MA, USA")).toEqual({
      kind: "location",
      location,
    });
  });

  it("an address with no coordinates (hand-typed, blur-committed) falls back to geocoding", () => {
    expect(seedPlan(null, null, "286 Pine Street, Weymouth, MA, USA")).toEqual({
      kind: "geocode",
      address: "286 Pine Street, Weymouth, MA, USA",
    });
  });

  it("no address and no coordinates is the named no-address state", () => {
    expect(seedPlan(null, null, "   ")).toEqual({ kind: "no-address" });
  });
});
