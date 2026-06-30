import { describe, it, expect } from "vitest";
import { money, addMoney, subMoney, fromDollars, toDollars, formatUsd } from "./money";

describe("Money", () => {
  it("is integer cents", () => {
    const amount = money(1999);
    expect(amount).toBe(1999);
  });

  it("fails fast on non-integer cents (programmer error)", () => {
    expect(() => money(1.5)).toThrow();
  });

  it("adds and subtracts while staying in cents", () => {
    expect(addMoney(money(1999), money(1))).toBe(2000);
    expect(subMoney(money(2000), money(500))).toBe(1500);
  });

  it("converts dollars to cents without float drift", () => {
    expect(fromDollars(19.99)).toBe(1999);
    expect(toDollars(money(1999))).toBeCloseTo(19.99);
    expect(formatUsd(money(192000))).toBe("$1920.00");
  });
});
