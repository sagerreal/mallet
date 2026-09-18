import { describe, it, expect } from "vitest";
import { mondayOf, weekRangeLabel } from "./time";

/**
 * The dispatch board's week used to begin on whatever day you happened to open it — "this week"
 * ran Thu→Wed — and its label read "Week of Thu", a weekday with no date. Paging left you unable
 * to say which week was on screen. These two helpers are the fix, so they are pinned here.
 *
 * Locale is passed explicitly ("en-US") so the assertions do not drift with the runner's locale;
 * the app calls it with no locale on purpose, which is what respects the dispatcher's own format.
 */
describe("mondayOf", () => {
  it("leaves a Monday where it is", () => {
    expect(mondayOf("2026-08-17")).toBe("2026-08-17"); // a Monday
  });

  it("snaps a mid-week day back to its Monday", () => {
    expect(mondayOf("2026-08-27")).toBe("2026-08-24"); // Thu → Mon
  });

  // The one that a naive `getDay()` subtraction gets wrong: Sunday is day 0, but it ENDS the
  // ISO week, so it must step back six days rather than forward one.
  it("treats Sunday as the END of its week, not the start", () => {
    expect(mondayOf("2026-08-23")).toBe("2026-08-17");
  });

  it("crosses a month boundary", () => {
    expect(mondayOf("2026-09-02")).toBe("2026-08-31");
  });

  it("crosses a year boundary", () => {
    expect(mondayOf("2026-01-01")).toBe("2025-12-29");
  });

  it("is idempotent — snapping a snapped date changes nothing", () => {
    expect(mondayOf(mondayOf("2026-08-27"))).toBe("2026-08-24");
  });
});

describe("weekRangeLabel", () => {
  it("names both ends, dropping the repeated month", () => {
    expect(weekRangeLabel("2026-08-17", "en-US")).toBe("Aug 17 – 23");
  });

  it("keeps the second month when the week spans two", () => {
    expect(weekRangeLabel("2026-08-31", "en-US")).toBe("Aug 31 – Sep 6");
  });

  it("spans a year boundary", () => {
    expect(weekRangeLabel("2025-12-29", "en-US")).toBe("Dec 29 – Jan 4");
  });
});
