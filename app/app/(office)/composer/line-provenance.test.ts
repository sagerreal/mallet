import { describe, it, expect } from "vitest";
import { normDesc, lineProvenance } from "./line-provenance";

const services = [
  { name: "Water heater swap (40gal gas)" },
  { name: "Drain cleaning" },
];

describe("normDesc", () => {
  it("trims, collapses whitespace, and casefolds", () => {
    expect(normDesc("  Water   Heater  SWAP (40gal Gas) ")).toBe("water heater swap (40gal gas)");
  });
});

describe("lineProvenance", () => {
  it("returns 'pricebook' on an exact normalized name match", () => {
    expect(lineProvenance("Water heater swap (40gal gas)", services)).toBe("pricebook");
    expect(lineProvenance("  water heater SWAP (40gal gas)  ", services)).toBe("pricebook");
  });
  it("returns null for an off-book / non-matching line", () => {
    expect(lineProvenance("Off-book: Haul away old unit", services)).toBeNull();
    expect(lineProvenance("Thermal expansion tank", services)).toBeNull();
  });
  it("returns null for an empty or whitespace-only description", () => {
    expect(lineProvenance("", services)).toBeNull();
    expect(lineProvenance("   ", services)).toBeNull();
    expect(lineProvenance(null, services)).toBeNull();
  });
  it("returns null when the pricebook is empty", () => {
    expect(lineProvenance("Water heater swap (40gal gas)", [])).toBeNull();
  });
});
