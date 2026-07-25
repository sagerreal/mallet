import { describe, it, expect } from "vitest";
import { isOk } from "@mallet/shared/types";
import {
  toWallClock,
  splitAtMidnight,
  type WallClock,
  type DaySegment,
} from "./wall-clock";

const LA = "America/Los_Angeles";

const unwrapClock = (r: ReturnType<typeof toWallClock>): WallClock => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

const unwrapSplit = (r: ReturnType<typeof splitAtMidnight>): readonly DaySegment[] => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

// Independent of the module under test on purpose: the loss assertions must not be measured with
// the same arithmetic that produced the rows.
const clockMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

const billedMinutes = (rows: readonly DaySegment[]): number =>
  rows.reduce((sum, r) => sum + (clockMinutes(r.endTime) - clockMinutes(r.startTime)), 0);

const elapsedMinutes = (startedAt: Date, endedAt: Date): number =>
  (endedAt.getTime() - startedAt.getTime()) / 60_000;

describe("toWallClock — the shop's timezone decides the work day", () => {
  it("an evening instant that is already tomorrow in UTC still lands on the local work day", () => {
    // 2026-07-07 21:30 PDT is 2026-07-08 04:30 UTC. A UTC read would file these hours on the 8th.
    const clock = unwrapClock(toWallClock(new Date("2026-07-08T04:30:00Z"), LA));

    expect(clock.workDate).toBe("2026-07-07");
    expect(clock.hhmm).toBe("21:30");
  });

  it("a morning instant in a positive-offset zone lands on the local work day, not the UTC one", () => {
    // 2026-07-08 08:30 Sydney (UTC+10) is 2026-07-07 22:30 UTC — the mirror-image failure.
    const clock = unwrapClock(toWallClock(new Date("2026-07-07T22:30:00Z"), "Australia/Sydney"));

    expect(clock.workDate).toBe("2026-07-08");
    expect(clock.hhmm).toBe("08:30");
  });

  it("truncates seconds instead of rounding them, so 23:59:40 never becomes 24:00", () => {
    const clock = unwrapClock(toWallClock(new Date("2026-07-07T23:59:40Z"), "UTC"));

    expect(clock.workDate).toBe("2026-07-07");
    expect(clock.hhmm).toBe("23:59");
  });

  it("truncates a mid-minute instant down to the minute it is inside", () => {
    const clock = unwrapClock(toWallClock(new Date("2026-07-07T16:45:59Z"), "UTC"));

    expect(clock.hhmm).toBe("16:45");
  });

  it("renders midnight as 00:00, never 24:00", () => {
    const clock = unwrapClock(toWallClock(new Date("2026-07-08T07:00:00Z"), LA));

    expect(clock.workDate).toBe("2026-07-08");
    expect(clock.hhmm).toBe("00:00");
  });

  it("rejects an unknown IANA zone rather than silently falling back to UTC", () => {
    const result = toWallClock(new Date("2026-07-08T04:30:00Z"), "Not/AZone");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("timeZone");
    }
  });

  it("rejects an empty timezone rather than silently falling back to UTC", () => {
    const result = toWallClock(new Date("2026-07-08T04:30:00Z"), "");

    expect(result.ok).toBe(false);
  });

  it("rejects an invalid instant instead of emitting NaN parts", () => {
    const result = toWallClock(new Date("not a date"), LA);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("instant");
  });
});

describe("toWallClock — DST transitions read as a human reads a clock", () => {
  // US DST 2026 starts Sunday 8 March: 02:00 PST jumps to 03:00 PDT (UTC-8 -> UTC-7).
  it("spring-forward morning is not shifted by an hour", () => {
    const before = unwrapClock(toWallClock(new Date("2026-03-08T09:00:00Z"), LA));
    const after = unwrapClock(toWallClock(new Date("2026-03-08T11:00:00Z"), LA));

    expect(before).toEqual({ workDate: "2026-03-08", hhmm: "01:00" });
    expect(after).toEqual({ workDate: "2026-03-08", hhmm: "04:00" });
  });

  // US DST 2026 ends Sunday 1 November: 02:00 PDT falls back to 01:00 PST (UTC-7 -> UTC-8), so
  // the 01:00 hour is walked twice.
  it("fall-back morning reads the repeated hour as the clock on the wall shows it", () => {
    const firstOneAm = unwrapClock(toWallClock(new Date("2026-11-01T08:00:00Z"), LA));
    const secondOneThirty = unwrapClock(toWallClock(new Date("2026-11-01T09:30:00Z"), LA));
    const twoAm = unwrapClock(toWallClock(new Date("2026-11-01T10:00:00Z"), LA));

    expect(firstOneAm).toEqual({ workDate: "2026-11-01", hhmm: "01:00" });
    expect(secondOneThirty).toEqual({ workDate: "2026-11-01", hhmm: "01:30" });
    expect(twoAm).toEqual({ workDate: "2026-11-01", hhmm: "02:00" });
  });
});

describe("splitAtMidnight — a segment inside one local day stays one row", () => {
  it("returns a single row for an ordinary same-day visit", () => {
    const rows = unwrapSplit(
      splitAtMidnight(
        {
          startedAt: new Date("2026-07-07T15:00:00Z"), // 08:00 PDT
          endedAt: new Date("2026-07-07T18:30:00Z"), // 11:30 PDT
        },
        LA,
      ),
    );

    expect(rows).toEqual([{ workDate: "2026-07-07", startTime: "08:00", endTime: "11:30" }]);
  });

  it("spans a spring-forward gap as one row whose wall times a human would recognise", () => {
    // Two real hours of work, but the clock on the wall moved three hours: 01:00 -> 04:00.
    const startedAt = new Date("2026-03-08T09:00:00Z");
    const endedAt = new Date("2026-03-08T11:00:00Z");

    const rows = unwrapSplit(splitAtMidnight({ startedAt, endedAt }, LA));

    expect(rows).toEqual([{ workDate: "2026-03-08", startTime: "01:00", endTime: "04:00" }]);
    expect(elapsedMinutes(startedAt, endedAt)).toBe(120);
  });

  it("spans a fall-back repeated hour as one row whose wall times a human would recognise", () => {
    // 00:30 PDT to 01:30 PST is two real hours; the wall clock only advances one.
    const startedAt = new Date("2026-11-01T07:30:00Z");
    const endedAt = new Date("2026-11-01T09:30:00Z");

    const rows = unwrapSplit(splitAtMidnight({ startedAt, endedAt }, LA));

    expect(rows).toEqual([{ workDate: "2026-11-01", startTime: "00:30", endTime: "01:30" }]);
    expect(elapsedMinutes(startedAt, endedAt)).toBe(120);
  });
});

describe("splitAtMidnight — crossing local midnight splits into one row per local day", () => {
  it("splits one crossing into two rows that meet at 23:59 and 00:00", () => {
    const rows = unwrapSplit(
      splitAtMidnight(
        {
          startedAt: new Date("2026-07-08T05:00:00Z"), // 2026-07-07 22:00 PDT
          endedAt: new Date("2026-07-08T08:30:00Z"), // 2026-07-08 01:30 PDT
        },
        LA,
      ),
    );

    expect(rows).toEqual([
      { workDate: "2026-07-07", startTime: "22:00", endTime: "23:59" },
      { workDate: "2026-07-08", startTime: "00:00", endTime: "01:30" },
    ]);
  });

  it("loses exactly one minute per midnight crossing — the accepted cost of HH:MM columns", () => {
    const startedAt = new Date("2026-07-08T05:00:00Z"); // 22:00 local
    const endedAt = new Date("2026-07-08T08:30:00Z"); // 01:30 local, next day

    const rows = unwrapSplit(splitAtMidnight({ startedAt, endedAt }, LA));

    expect(rows).toHaveLength(2);
    expect(elapsedMinutes(startedAt, endedAt)).toBe(210);
    expect(billedMinutes(rows)).toBe(209);
    // Documented tradeoff: 23:59 -> 00:00 is unbillable because "24:00" is not a valid `time`.
    expect(elapsedMinutes(startedAt, endedAt) - billedMinutes(rows)).toBe(1);
  });

  it("splits two crossings into three rows, with a full filler day in the middle", () => {
    const startedAt = new Date("2026-07-08T05:00:00Z"); // 2026-07-07 22:00 PDT
    const endedAt = new Date("2026-07-09T08:30:00Z"); // 2026-07-09 01:30 PDT

    const rows = unwrapSplit(splitAtMidnight({ startedAt, endedAt }, LA));

    expect(rows).toEqual([
      { workDate: "2026-07-07", startTime: "22:00", endTime: "23:59" },
      { workDate: "2026-07-08", startTime: "00:00", endTime: "23:59" },
      { workDate: "2026-07-09", startTime: "00:00", endTime: "01:30" },
    ]);
    // Two crossings, so exactly two minutes are lost.
    expect(elapsedMinutes(startedAt, endedAt) - billedMinutes(rows)).toBe(2);
  });

  it("rolls the calendar across a month boundary", () => {
    const rows = unwrapSplit(
      splitAtMidnight(
        {
          startedAt: new Date("2026-08-01T05:00:00Z"), // 2026-07-31 22:00 PDT
          endedAt: new Date("2026-08-01T08:00:00Z"), // 2026-08-01 01:00 PDT
        },
        LA,
      ),
    );

    expect(rows).toEqual([
      { workDate: "2026-07-31", startTime: "22:00", endTime: "23:59" },
      { workDate: "2026-08-01", startTime: "00:00", endTime: "01:00" },
    ]);
  });
});

describe("splitAtMidnight — never emits a zero-length row", () => {
  it("a segment ending exactly at local midnight belongs wholly to the earlier day", () => {
    const rows = unwrapSplit(
      splitAtMidnight(
        {
          startedAt: new Date("2026-07-08T03:00:00Z"), // 2026-07-07 20:00 PDT
          endedAt: new Date("2026-07-08T07:00:00Z"), // 2026-07-08 00:00 PDT exactly
        },
        LA,
      ),
    );

    expect(rows).toEqual([{ workDate: "2026-07-07", startTime: "20:00", endTime: "23:59" }]);
    // No 00:00 -> 00:00 tail row for the following day.
    expect(rows).toHaveLength(1);
  });

  it("rejects a segment whose wall clock runs backwards over a fall-back, instead of emitting a negative row", () => {
    // 01:30 PDT to 01:10 PST is 40 real minutes forward, but the wall clock moved BACKWARDS.
    // HH:MM columns cannot say which pass of the repeated hour a time belongs to, so the only
    // honest answer is a validation error — not a row TimeEntry would later reject.
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-11-01T08:30:00Z"), // 01:30 PDT
        endedAt: new Date("2026-11-01T09:10:00Z"), // 01:10 PST
      },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("endedAt");
  });

  it("rejects a fall-back hour that begins and ends on the same wall time", () => {
    // Exactly one real hour of work, but both ends read 01:30 because the hour repeated.
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-11-01T08:30:00Z"), // 01:30 PDT
        endedAt: new Date("2026-11-01T09:30:00Z"), // 01:30 PST
      },
      LA,
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a sub-minute segment, which has no representable HH:MM row", () => {
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-07-07T15:00:10Z"),
        endedAt: new Date("2026-07-07T15:00:50Z"),
      },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("endedAt");
  });
});

describe("splitAtMidnight — boundary validation", () => {
  it("rejects endedAt before startedAt", () => {
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-07-07T18:00:00Z"),
        endedAt: new Date("2026-07-07T15:00:00Z"),
      },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("endedAt");
  });

  it("rejects endedAt equal to startedAt", () => {
    const at = new Date("2026-07-07T18:00:00Z");
    const result = splitAtMidnight({ startedAt: at, endedAt: at }, LA);

    expect(result.ok).toBe(false);
  });

  it("rejects an unknown IANA zone rather than splitting on UTC days", () => {
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-07-08T05:00:00Z"),
        endedAt: new Date("2026-07-08T08:30:00Z"),
      },
      "Mars/Olympus_Mons",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("timeZone");
  });

  it("rejects an invalid instant", () => {
    const result = splitAtMidnight(
      { startedAt: new Date("nope"), endedAt: new Date("2026-07-08T08:30:00Z") },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("startedAt");
  });

  it("names endedAt when endedAt is the invalid instant, so the caller knows which end is bad", () => {
    const result = splitAtMidnight(
      { startedAt: new Date("2026-07-08T05:00:00Z"), endedAt: new Date("nope") },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("endedAt");
  });

  it("accepts a span of exactly the maximum number of local days", () => {
    const rows = unwrapSplit(
      splitAtMidnight(
        {
          startedAt: new Date("2026-07-08T05:00:00Z"), // 2026-07-07 22:00 PDT
          endedAt: new Date("2026-07-13T08:30:00Z"), // 2026-07-13 01:30 PDT
        },
        LA,
      ),
    );

    expect(rows).toHaveLength(7);
    expect(rows[0]?.workDate).toBe("2026-07-07");
    expect(rows[6]?.workDate).toBe("2026-07-13");
  });

  it("refuses a span one day past the maximum, so the limit means what its message says", () => {
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-07-08T05:00:00Z"), // 2026-07-07 22:00 PDT
        endedAt: new Date("2026-07-14T08:30:00Z"), // 2026-07-14 01:30 PDT — 8 local days
      },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("endedAt");
  });

  it("refuses a runaway span rather than emitting filler days without end", () => {
    const result = splitAtMidnight(
      {
        startedAt: new Date("2026-07-01T05:00:00Z"), // 2026-06-30 22:00 PDT
        endedAt: new Date("2026-07-12T08:30:00Z"), // 2026-07-12 01:30 PDT
      },
      LA,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("endedAt");
  });
});
