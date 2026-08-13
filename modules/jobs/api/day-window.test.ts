import { describe, it, expect } from "vitest";
import { DAY_PAGER_BOUND_DAYS, withinDayPagerBound } from "./day-window";

// The server's guard on v1.field.day's date input. The CLIENT owns the exact ±14-day pager rule
// (it knows the van's timezone); this bound only has to stop a runaway or forged date, so it is
// deliberately one day looser than the pager on each side.

const NOW = new Date("2026-08-12T17:30:00Z"); // mid-afternoon UTC, an ordinary instant

describe("withinDayPagerBound", () => {
  it("accepts today", () => {
    expect(withinDayPagerBound("2026-08-12", NOW)).toBe(true);
  });

  it("accepts the full pager reach both ways", () => {
    expect(withinDayPagerBound("2026-08-26", NOW)).toBe(true); // +14
    expect(withinDayPagerBound("2026-07-29", NOW)).toBe(true); // -14
  });

  it("accepts the one-day timezone slack past the pager", () => {
    // A client at UTC-11 paging to its +14th day can name a date 15 UTC-days out.
    expect(withinDayPagerBound("2026-08-27", NOW)).toBe(true); // +15
    expect(withinDayPagerBound("2026-07-28", NOW)).toBe(true); // -15
  });

  it("rejects a date past the slack", () => {
    expect(withinDayPagerBound("2026-08-28", NOW)).toBe(false); // +16
    expect(withinDayPagerBound("2026-07-27", NOW)).toBe(false); // -16
  });

  it("rejects a far date outright — the pager is not a history browser", () => {
    expect(withinDayPagerBound("2025-08-12", NOW)).toBe(false);
    expect(withinDayPagerBound("2027-01-01", NOW)).toBe(false);
  });

  it("rejects a well-formed but impossible date", () => {
    // The zod regex upstream passes these through; the bound must not let NaN math admit them.
    expect(withinDayPagerBound("2026-13-01", NOW)).toBe(false);
    expect(withinDayPagerBound("2026-02-30", NOW)).toBe(false);
    expect(withinDayPagerBound("2026-02-29", NOW)).toBe(false); // 2026 is not a leap year
    expect(withinDayPagerBound("2026-04-31", NOW)).toBe(false);
  });

  it("exports the bound the error message names", () => {
    expect(DAY_PAGER_BOUND_DAYS).toBe(15);
  });
});
