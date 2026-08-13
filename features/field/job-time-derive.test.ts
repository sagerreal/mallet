/**
 * Job attribution — what a shift's hours were spent on.
 *
 * The assertions here defend one idea against the instinct to "fix" it: job time does NOT sum to the
 * shift, and nothing in this file may make it. Drive time is paid and belongs to no job; a shop
 * morning has no visit at all. Code that balances these has misunderstood both records.
 *
 * The second idea is that an unmeasured visit is ABSENT, not zero. Zero is a measurement — "he was
 * there and it took no time" — and a timesheet that says it about a visit nobody tapped is lying in
 * the technician's own name.
 */
import { describe, it, expect } from "vitest";
import {
  stampLabel,
  stampHHMM,
  stampHours,
  jobTimeForDate,
  jobTimeTotals,
  jobTimeGapNote,
  toJobTimeRow,
  type VisitStamp,
} from "./job-time-derive";

/** A local wall clock on the fixture's day, as an instant — so assertions hold in any timezone. */
const at = (hhmm: string): string => new Date(`2026-07-01T${hhmm}:00`).toISOString();

const stamp = (over: Partial<VisitStamp> = {}): VisitStamp => ({
  visitId: "v1",
  jobId: "j1",
  jobNum: "JOB-1001",
  jobTitle: "Water heater swap",
  customerName: "Alvarez",
  workDate: "2026-07-01",
  startedAt: at("09:00"),
  completedAt: at("11:30"),
  ...over,
});

describe("stampHours", () => {
  it("measures the gap between Arrived and Done", () => {
    expect(stampHours(stamp())).toBe(2.5);
  });

  it.each([
    ["never arrived", { startedAt: null }],
    ["still on the job", { completedAt: null }],
    ["neither tap", { startedAt: null, completedAt: null }],
  ])("returns null, not zero, when %s", (_label, over) => {
    expect(stampHours(stamp(over))).toBeNull();
  });

  it("returns null for an end before its start — a wrong clock, not a negative shift", () => {
    expect(stampHours(stamp({ startedAt: at("11:00"), completedAt: at("09:00") }))).toBeNull();
  });

  it("returns null rather than zero for a same-minute pair", () => {
    // Tapping Done by accident a second after Arrived is a mis-tap, and calling it 0.00 h would
    // present it as a measurement of a visit that took no time.
    expect(stampHours(stamp({ startedAt: at("09:00"), completedAt: at("09:00") }))).toBeNull();
  });
});

describe("a row names WHICH tap is missing", () => {
  it("says the arrival is missing when he tapped Done and not Arrived", () => {
    // "Not stamped" would be false — it WAS stamped. The office needs to know which tap to add, and
    // he needs a row he can act on rather than one he can only shrug at.
    expect(toJobTimeRow(stamp({ startedAt: null })).missing).toBe("arrival");
  });

  it("says both when nobody tapped at all", () => {
    expect(toJobTimeRow(stamp({ startedAt: null, completedAt: null })).missing).toBe("both");
  });

  it("says nothing is missing when the pair measures", () => {
    expect(toJobTimeRow(stamp()).missing).toBeNull();
  });

  it("says nothing is missing about a visit he is standing on right now", () => {
    // Running, not broken: the Done tap is not missing, it has not happened yet.
    expect(toJobTimeRow(stamp({ completedAt: null })).missing).toBeNull();
  });
});

describe("a row", () => {
  it("is running while he has arrived and not finished", () => {
    expect(toJobTimeRow(stamp({ completedAt: null })).running).toBe(true);
  });

  it("is not running when he never arrived", () => {
    expect(toJobTimeRow(stamp({ startedAt: null, completedAt: null })).running).toBe(false);
  });
});

describe("one date's rows", () => {
  it("keeps only that date", () => {
    const rows = jobTimeForDate(
      [stamp({ visitId: "a" }), stamp({ visitId: "b", workDate: "2026-07-02" })],
      "2026-07-01",
    );
    expect(rows.map((r) => r.key)).toEqual(["a"]);
  });

  it("reads in the order the day happened", () => {
    const rows = jobTimeForDate(
      [
        stamp({ visitId: "afternoon", startedAt: at("13:00"), completedAt: at("15:00") }),
        stamp({ visitId: "morning", startedAt: at("08:00"), completedAt: at("09:00") }),
      ],
      "2026-07-01",
    );
    expect(rows.map((r) => r.key)).toEqual(["morning", "afternoon"]);
  });

  it("keeps an unstamped visit, sorted last — dropping it is how a missing tap disappears", () => {
    const rows = jobTimeForDate(
      [
        stamp({ visitId: "untapped", startedAt: null, completedAt: null }),
        stamp({ visitId: "tapped", startedAt: at("08:00"), completedAt: at("09:00") }),
      ],
      "2026-07-01",
    );
    expect(rows.map((r) => r.key)).toEqual(["tapped", "untapped"]);
    expect(rows[1]?.hours).toBeNull();
  });
});

describe("totals", () => {
  it("adds only what was measured, and counts what was not", () => {
    const rows = jobTimeForDate(
      [
        stamp({ visitId: "a", startedAt: at("08:00"), completedAt: at("10:00") }),
        stamp({ visitId: "b", startedAt: at("10:30"), completedAt: at("12:00") }),
        stamp({ visitId: "c", startedAt: null, completedAt: null }),
      ],
      "2026-07-01",
    );
    const totals = jobTimeTotals(rows);
    expect(totals.attributed).toBe(3.5);
    expect(totals.unmeasured).toBe(1);
  });
});

describe("the gap between a shift and its jobs", () => {
  it("is EXPLAINED when it is worth a sentence", () => {
    // 8h on the clock, 6.25h on jobs: the difference is drive time and the shop, and a man who reads
    // both numbers will ask. The answer is a sentence, never an invented row.
    const note = jobTimeGapNote(8, 6.25);
    expect(note).toContain("1.75 h");
    expect(note).toMatch(/driving|shop/);
  });

  it("says nothing about a couple of minutes — narrating rounding teaches people to stop reading", () => {
    expect(jobTimeGapNote(8, 7.9)).toBeNull();
  });

  it("says nothing when the jobs account for the whole shift", () => {
    expect(jobTimeGapNote(8, 8)).toBeNull();
  });

  it("never reports a NEGATIVE gap as a problem — job time may exceed the shift", () => {
    // A visit can be stamped outside the shift the register shows: the clock and the visit taps are
    // independent records, and neither gets to rewrite the other.
    expect(jobTimeGapNote(6, 8)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// THE TIMEZONE. Visit stamps are absolute instants; a timesheet shows wall clocks. Rendering them
// in SQL put them in the DATABASE's timezone, so a technician who arrived at eight in California
// read "3p" on his own timesheet — and the unreported-day card offered to WRITE those hours.
// ---------------------------------------------------------------------------

describe("rendering an instant as the clock he was looking at", () => {
  it("uses the DEVICE's timezone, not the database's", () => {
    // Built as a local wall clock, so this assertion holds wherever the test runs — which is the
    // property the old SQL rendering did not have.
    const eightAmLocal = new Date("2026-07-01T08:04:00").toISOString();
    expect(stampLabel(eightAmLocal)).toBe("8:04a");
    expect(stampHHMM(eightAmLocal)).toBe("08:04");
  });

  it("renders an afternoon as an afternoon", () => {
    const fourThirtyPm = new Date("2026-07-01T16:30:00").toISOString();
    expect(stampLabel(fourThirtyPm)).toBe("4:30p");
    expect(stampHHMM(fourThirtyPm)).toBe("16:30");
  });

  it("pads the stored form to HH:MM, because a time column will not take '8:4'", () => {
    expect(stampHHMM(new Date("2026-07-01T08:04:00").toISOString())).toMatch(/^\d\d:\d\d$/);
  });

  it("says nothing rather than guessing when there is no stamp", () => {
    expect(stampLabel(null)).toBe("—");
  });

  it("measures a visit across a DST change by the instants, not the wall clocks", () => {
    // US spring-forward 2026-03-08: 01:00 → 03:00 local. A wall-clock subtraction would report three
    // hours for two hours of work.
    const hours = stampHours(
      stamp({
        startedAt: "2026-03-08T09:30:00.000Z",
        completedAt: "2026-03-08T11:30:00.000Z",
      }),
    );
    expect(hours).toBe(2);
  });
});
