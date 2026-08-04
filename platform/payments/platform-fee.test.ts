import { describe, it, expect } from "vitest";
import { platformFeeCents, PLATFORM_FEE_BPS } from "./platform-fee";

describe("platformFeeCents", () => {
  it("uses a 0.25% (25 bps) rate", () => {
    expect(PLATFORM_FEE_BPS).toBe(25);
  });

  const cases: Array<[string, number, number]> = [
    ["$400.00 → $1.00", 40_000, 100],
    ["$20.00 → $0.05", 2_000, 5],
    ["$10.00 → $0.03 (2.5¢ rounds up)", 1_000, 3],
    ["$2.00 → $0.01 (0.5¢ rounds up)", 200, 1],
    ["$1.00 → $0.00 (0.25¢ rounds down)", 100, 0],
    ["the $0.50 card minimum → $0.00", 50, 0],
    ["zero → 0", 0, 0],
    ["negative → 0", -100, 0],
  ];
  it.each(cases)("%s", (_label, amountCents, expected) => {
    expect(platformFeeCents(amountCents)).toBe(expected);
  });

  it("never exceeds the charge amount", () => {
    for (const amount of [50, 100, 1_000, 40_000, 1_000_000]) {
      expect(platformFeeCents(amount)).toBeLessThan(amount);
    }
  });
});
