import { describe, it, expect } from "vitest";
import { formatMoney, formatDate } from "./format";

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
