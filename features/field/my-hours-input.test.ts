import { describe, it, expect } from "vitest";
import { myHoursListInput, myHoursWeekBounds } from "./my-hours-input";
import { weekStart, weekDates } from "./my-hours-derive";

// @/lib/clock is mocked globally to 2026-07-01, a Wednesday — see vitest.setup.ts.
const TODAY = "2026-07-01";

/**
 * THE PAGER AND THE WINDOW ARE ONE PAIR. My hours fetches a fixed twelve-week window once, and the
 * week arrows moved through it with no bound at all — so a few taps back the register stated "No
 * shifts recorded this week" over weeks the technician had genuinely worked, and forward it walked
 * off into years nobody has booked. A navigator may not leave the data it navigates.
 */
describe("myHoursWeekBounds", () => {
  const bounds = myHoursWeekBounds(TODAY);
  const window = myHoursListInput("tech");

  it("starts at the oldest week the window covers END TO END", () => {
    // The window opens mid-week (twelve weeks back from a Wednesday is a Wednesday). Stopping on
    // that part-week would report its first two days as recorded-nothing, which is the lie.
    expect(bounds.first).toBe("2026-04-13");
    expect(weekDates(bounds.first).every((d) => d >= window.fromDate)).toBe(true);
  });

  it("gives up no more than the one part-week", () => {
    expect(weekStart(window.fromDate)).toBe("2026-04-06");
  });

  it("stops forward paging at the last week the window reaches", () => {
    expect(bounds.last).toBe(weekStart(window.toDate));
    expect(bounds.last).toBe("2026-07-06");
  });

  it("contains this week — the week the page opens on", () => {
    expect(bounds.first <= weekStart(TODAY)).toBe(true);
    expect(bounds.last >= weekStart(TODAY)).toBe(true);
  });
});
