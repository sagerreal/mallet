import { describe, it, expect } from "vitest";
import { standardDayMinutes, weekdayOf } from "./standard-day";

// The DAY TOTAL ring's denominator: how long this person's working day IS — their own
// crew-schedule row for the weekday, else the org's default hours, else nothing (a day off
// draws an empty ring, never a full one).

const ORG_HOURS = {
  hoursWdOpen: 8,
  hoursWdClose: 17,
  hoursSatOpen: 9,
  hoursSatClose: 13,
  hoursSunOpen: 0,
  hoursSunClose: 0,
};

describe("weekdayOf", () => {
  it("derives the weekday from the date alone, immune to server timezone", () => {
    expect(weekdayOf("2026-08-12")).toBe(3); // Wednesday
    expect(weekdayOf("2026-08-15")).toBe(6); // Saturday
    expect(weekdayOf("2026-08-16")).toBe(0); // Sunday
  });
});

describe("standardDayMinutes", () => {
  it("prefers the person's own crew-schedule row for the weekday", () => {
    expect(standardDayMinutes(3, { openHour: 7, closeHour: 15 }, ORG_HOURS)).toBe(480);
  });

  it("falls back to the org's weekday hours when the person has no row", () => {
    expect(standardDayMinutes(3, null, ORG_HOURS)).toBe(9 * 60);
  });

  it("uses the org's Saturday and Sunday hours on those days", () => {
    expect(standardDayMinutes(6, null, ORG_HOURS)).toBe(4 * 60);
    // 0..0 is the closed-day convention (org-settings.ts) — a day off has no standard.
    expect(standardDayMinutes(0, null, ORG_HOURS)).toBeNull();
  });

  it("treats a personal 0..0 row as that person's day off, even when the org is open", () => {
    expect(standardDayMinutes(3, { openHour: 0, closeHour: 0 }, ORG_HOURS)).toBeNull();
  });

  it("never returns a negative or zero span from malformed hours", () => {
    expect(standardDayMinutes(3, { openHour: 17, closeHour: 8 }, ORG_HOURS)).toBeNull();
  });
});
