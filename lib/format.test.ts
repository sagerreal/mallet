import { describe, it, expect } from "vitest";
import { formatMoney, formatDate, fmtPhone, fmt$, fmt$rate } from "./format";

describe("format", () => {
  it("renders integer cents as dollars", () => {
    expect(formatMoney(0)).toBe("$0.00");
    expect(formatMoney(123456)).toBe("$1,234.56");
  });
  it("renders null dates as an em dash", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate("2026-07-01T15:00:00.000Z")).toMatch(/Jul/);
  });
});

describe("fmt$", () => {
  it("renders whole dollars with thousands separators", () => {
    expect(fmt$(0)).toBe("$0");
    expect(fmt$(2450.4)).toBe("$2,450");
  });
  // A negative figure printed as "$-41" reads as a price of minus-41; the sign belongs to the
  // amount, ahead of the currency. Composer totals fed it a negative before the discount was
  // clamped, which is how "+$-41" reached a quote.
  it("puts the sign ahead of the currency, never inside it", () => {
    expect(fmt$(-41)).toBe("-$41");
    expect(fmt$(-2450)).toBe("-$2,450");
  });
});

describe("fmtPhone", () => {
  it("formats E.164 and 10-digit US numbers", () => {
    expect(fmtPhone("+19255550100")).toBe("(925) 555-0100");
    expect(fmtPhone("9255550100")).toBe("(925) 555-0100");
    expect(fmtPhone("(925) 555-0100")).toBe("(925) 555-0100");
  });
  it("passes unrecognizable input through untouched", () => {
    expect(fmtPhone("ext. 44")).toBe("ext. 44");
    expect(fmtPhone("")).toBe("");
  });
});

describe("fmt$rate — a rate is whatever precision it actually has", () => {
  // fmt$ was right while a service meant "$2,400 water heater install". The moment a shop prices
  // per square foot it is wrong: a painter's whole book sits between $0.16 and $3.30 a unit.
  it("keeps the cents on a sub-dollar rate instead of showing $0", () => {
    expect(fmt$rate(0.16)).toBe("$0.16");
  });

  it("keeps the cents on a rate that has them", () => {
    expect(fmt$rate(2.25)).toBe("$2.25");
  });

  it("leaves a whole-dollar rate alone — no gratuitous .00", () => {
    expect(fmt$rate(123)).toBe("$123");
  });

  it("still groups thousands", () => {
    expect(fmt$rate(2400)).toBe("$2,400");
  });

  it("handles a negative rate the way fmt$ does", () => {
    expect(fmt$rate(-41)).toBe("-$41");
  });
});
