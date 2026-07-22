import { describe, it, expect } from "vitest";
import { formatMoney, formatDate, fmtPhone } from "./format";

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
