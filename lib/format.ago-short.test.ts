import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { agoShort } from "./format";

/**
 * How recent an activity is, in a list column.
 *
 * The Customers list already ORDERS by last activity — that has been the default sort since the
 * server took over the read. What it could not do was SAY so: the Latest column rendered a
 * prototype-only prose field that the database hydrator sets to "", so it was blank on every real
 * customer while the rows around it were sorted by exactly that value.
 *
 * Recent dates are the ones a shop acts on, so they read in the units an owner thinks in ("3d
 * ago"). Past a month, the relative form stops being useful — "7w ago" is arithmetic, "Jun 12" is
 * a fact — so it switches to a date.
 */

const NOW = new Date("2026-08-01T14:00:00Z");
const daysBefore = (n: number, hours = 0) =>
  new Date(NOW.getTime() - n * 86_400_000 - hours * 3_600_000).toISOString();

describe("agoShort", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it("says Today rather than '0d ago'", () => {
    expect(agoShort(daysBefore(0, 3))).toBe("Today");
  });

  it("says Yesterday — the word beats the number at n=1", () => {
    expect(agoShort(daysBefore(1))).toBe("Yesterday");
  });

  it("counts days through the first week", () => {
    expect(agoShort(daysBefore(3))).toBe("3d ago");
    expect(agoShort(daysBefore(6))).toBe("6d ago");
  });

  it("counts weeks up to a month", () => {
    expect(agoShort(daysBefore(7))).toBe("1w ago");
    expect(agoShort(daysBefore(20))).toBe("2w ago");
  });

  // Past a month the relative form is arithmetic, not information.
  it("falls back to a plain date once it is old", () => {
    expect(agoShort(daysBefore(45))).toBe("Jun 17");
  });

  it("names the year when it is not this one — 'Aug 3' alone would read as recent", () => {
    expect(agoShort("2024-08-03T12:00:00Z")).toBe("Aug 3, 2024");
  });

  // A blank column is what this replaces; it must not be replaced by "Invalid Date" or "NaNd ago".
  it("renders an em dash for a missing timestamp", () => {
    expect(agoShort(null)).toBe("—");
    expect(agoShort(undefined)).toBe("—");
  });

  it("renders an em dash for an unparseable timestamp rather than NaN", () => {
    expect(agoShort("not-a-date")).toBe("—");
  });

  // Clock skew between the server and the browser can put a stamp slightly ahead of now.
  it("treats a future stamp as Today, not '-1d ago'", () => {
    expect(agoShort(new Date(NOW.getTime() + 60_000).toISOString())).toBe("Today");
  });
});
