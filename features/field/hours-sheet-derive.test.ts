import { describe, it, expect } from "vitest";
import {
  shiftRows,
  offRows,
  weekSummary,
  overtimeSplit,
  missingWorkdays,
  overtimeRulePhrase,
  type MyHoursEntry,
  type OvertimePolicy,
} from "./hours-sheet-derive";

const FEDERAL: OvertimePolicy = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null };
const CALIFORNIA: OvertimePolicy = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 };

let seq = 0;
const punch = (over: Partial<MyHoursEntry> = {}): MyHoursEntry => {
  seq += 1;
  return {
    id: `e${seq}`,
    techUserId: "t1",
    jobId: null,
    workDate: "2026-08-10",
    kind: "shop",
    startTime: "08:00",
    endTime: "12:00",
    minutes: null,
    note: "",
    src: "clock",
    status: "draft",
    running: false,
    approvedAt: null,
    createdAt: "2026-08-10T08:00:00.000Z",
  } as MyHoursEntry;
};
const off = (over: Partial<MyHoursEntry> = {}): MyHoursEntry =>
  ({ ...punch(), kind: "pto", startTime: null, endTime: null, minutes: 480, ...over }) as MyHoursEntry;
const row = (over: Partial<MyHoursEntry> = {}): MyHoursEntry => ({ ...punch(), ...over }) as MyHoursEntry;

// ---------------------------------------------------------------------------
// SHIFT ROWS — one row per CLOCK SESSION, which is not the same as one run.
// A run splits at a break; a session contains its breaks and splits only where
// the technician actually went off the clock.
// ---------------------------------------------------------------------------

describe("shiftRows", () => {
  it("merges a chain of taps into one shift, with the break INSIDE it", () => {
    const rows = shiftRows([
      row({ kind: "shop", startTime: "07:30", endTime: "12:00" }),
      row({ kind: "break", startTime: "12:00", endTime: "12:30" }),
      row({ kind: "job", startTime: "12:30", endTime: "16:00" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.startTime).toBe("07:30");
    expect(rows[0]!.endTime).toBe("16:00");
    // 4.5h + 3.5h worked; the 30-minute break is unpaid and not in the total.
    expect(rows[0]!.hours).toBe(8);
    expect(rows[0]!.breaks).toHaveLength(1);
    expect(rows[0]!.breaks[0]).toMatchObject({ startTime: "12:00", endTime: "12:30" });
  });

  it("starts a SECOND row when the tech clocked out and back in the same day", () => {
    // The burst-pipe evening: done at noon, home, back on at 18:00.
    const rows = shiftRows([
      row({ startTime: "07:30", endTime: "12:00" }),
      row({ startTime: "18:00", endTime: "20:00" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.startTime, r.endTime])).toEqual([
      ["07:30", "12:00"],
      ["18:00", "20:00"],
    ]);
  });

  it("keeps every break on a long day rather than dropping the second one", () => {
    const rows = shiftRows([
      row({ startTime: "06:00", endTime: "10:00" }),
      row({ kind: "break", startTime: "10:00", endTime: "10:15" }),
      row({ startTime: "10:15", endTime: "13:00" }),
      row({ kind: "break", startTime: "13:00", endTime: "13:30" }),
      row({ startTime: "13:30", endTime: "17:00" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.breaks).toHaveLength(2);
    expect(rows[0]!.breakHours).toBeCloseTo(0.75, 5);
    expect(rows[0]!.hours).toBeCloseTo(10.25, 5);
  });

  it("marks a running shift and leaves its end open", () => {
    const rows = shiftRows([row({ startTime: "08:00", endTime: null, running: true })]);
    expect(rows[0]!.running).toBe(true);
    expect(rows[0]!.endTime).toBeNull();
  });

  it("never merges across a running row — nothing can follow an open stretch", () => {
    const rows = shiftRows([
      row({ startTime: "08:00", endTime: null, running: true }),
      row({ startTime: "13:00", endTime: "17:00" }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it("splits sessions across days and keeps each on its own date", () => {
    const rows = shiftRows([
      row({ workDate: "2026-08-10", startTime: "08:00", endTime: "16:00" }),
      row({ workDate: "2026-08-11", startTime: "08:00", endTime: "16:00" }),
    ]);
    expect(rows.map((r) => r.workDate)).toEqual(["2026-08-10", "2026-08-11"]);
  });

  it("is order-independent — the server returns a day in UUID order", () => {
    const a = row({ startTime: "13:00", endTime: "17:00" });
    const b = row({ startTime: "07:00", endTime: "11:00" });
    expect(shiftRows([a, b]).map((r) => r.startTime)).toEqual(["07:00", "13:00"]);
  });

  it("excludes time-off rows: they are not stretches of a day", () => {
    expect(shiftRows([off()])).toHaveLength(0);
  });

  it("reports provenance so a typed shift can say so, and a mixed one cannot claim to be tapped", () => {
    expect(shiftRows([row({ src: "clock" })])[0]!.src).toBe("clock");
    expect(shiftRows([row({ src: "manual" })])[0]!.src).toBe("manual");
    const mixed = shiftRows([
      row({ src: "clock", startTime: "08:00", endTime: "12:00" }),
      row({ src: "manual", startTime: "12:00", endTime: "16:00" }),
    ]);
    expect(mixed[0]!.src).toBe("mixed");
  });
});

describe("offRows", () => {
  it("returns one row per time-off entry, with its length in hours", () => {
    const rows = offRows([off({ kind: "vacation", minutes: 450 }), row()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ kind: "vacation", hours: 7.5, workDate: "2026-08-10" });
  });

  it("covers every time-off kind and nothing else", () => {
    const kinds = ["pto", "vacation", "sick", "holiday"] as const;
    expect(offRows(kinds.map((kind) => off({ kind }))).map((r) => r.kind)).toEqual([...kinds]);
    expect(offRows([row({ kind: "break" })])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// OVERTIME — the amendment that matters. Federal is weekly-40; California adds
// daily-8, and an hour must never be counted in both.
// ---------------------------------------------------------------------------

describe("overtimeSplit", () => {
  const day = (h: number) => h;

  it("federal: only hours past 40 in the week are overtime", () => {
    const split = overtimeSplit([day(10), day(10), day(10), day(10)], FEDERAL);
    expect(split).toMatchObject({ daily: 0, weekly: 0, total: 0 }); // 4x10 = exactly 40
    expect(overtimeSplit([day(10), day(10), day(10), day(10), day(10)], FEDERAL)).toMatchObject({
      daily: 0,
      weekly: 10,
      total: 10,
    });
  });

  it("california: five ten-hour days are 10h of DAILY overtime and no weekly", () => {
    // The double-count trap: 50 worked, 10 over 40 — but those same 10 are the daily overage.
    // Only the straight-time portion of each day (8h x 5 = 40) faces the weekly threshold.
    const split = overtimeSplit([10, 10, 10, 10, 10], CALIFORNIA);
    expect(split).toMatchObject({ daily: 10, weekly: 0, total: 10 });
  });

  it("california: six nine-hour days are 6h daily PLUS 8h weekly", () => {
    // 54 worked. Daily overage 1h x 6 = 6. Straight time 8 x 6 = 48, of which 8 pass 40.
    const split = overtimeSplit([9, 9, 9, 9, 9, 9], CALIFORNIA);
    expect(split).toMatchObject({ daily: 6, weekly: 8, total: 14 });
  });

  it("counts a single long day the same either way when the week is short", () => {
    expect(overtimeSplit([12], CALIFORNIA)).toMatchObject({ daily: 4, weekly: 0, total: 4 });
    expect(overtimeSplit([12], FEDERAL)).toMatchObject({ daily: 0, weekly: 0, total: 0 });
  });

  it("honours a non-standard policy — the shop sets its own thresholds", () => {
    const four_tens: OvertimePolicy = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 600 };
    expect(overtimeSplit([10, 10, 10, 10], four_tens)).toMatchObject({ total: 0 });
    const strict: OvertimePolicy = { weeklyThresholdMinutes: 2100, dailyThresholdMinutes: null };
    expect(overtimeSplit([8, 8, 8, 8, 8], strict)).toMatchObject({ weekly: 5, total: 5 });
  });

  it("is zero for an empty week and never negative", () => {
    expect(overtimeSplit([], CALIFORNIA)).toMatchObject({ daily: 0, weekly: 0, total: 0 });
    expect(overtimeSplit([2, 3], CALIFORNIA)).toMatchObject({ total: 0 });
  });
});

describe("overtimeRulePhrase", () => {
  it("names the rule in force so the figure is never mysterious", () => {
    expect(overtimeRulePhrase(FEDERAL)).toBe("past 40h this week");
    expect(overtimeRulePhrase(CALIFORNIA)).toBe("past 8h a day or 40h this week");
  });
});

// ---------------------------------------------------------------------------
// MISSING DAYS — the one timesheet gap worth interrupting anyone about.
// ---------------------------------------------------------------------------

describe("missingWorkdays", () => {
  const standard = (dates: readonly string[], minutes: number | null = 480) =>
    new Map(dates.map((d) => [d, minutes] as const));

  const WEEK = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"];

  it("flags an elapsed workday with no hours at all", () => {
    const missing = missingWorkdays({
      standardMinutesByDate: standard(WEEK),
      hoursByDate: new Map([["2026-08-10", 8]]),
      todayISO: "2026-08-12",
    });
    // Monday reported, Tuesday did not. Today is still in progress.
    expect(missing).toEqual(["2026-08-11"]);
  });

  it("never flags TODAY — a day still being worked cannot have been under-reported", () => {
    const missing = missingWorkdays({
      standardMinutesByDate: standard(["2026-08-12"]),
      hoursByDate: new Map(),
      todayISO: "2026-08-12",
    });
    expect(missing).toEqual([]);
  });

  it("never flags the future", () => {
    const missing = missingWorkdays({
      standardMinutesByDate: standard(["2026-08-14"]),
      hoursByDate: new Map(),
      todayISO: "2026-08-12",
    });
    expect(missing).toEqual([]);
  });

  it("does not flag a day this person does not work", () => {
    const missing = missingWorkdays({
      standardMinutesByDate: new Map([["2026-08-10", null]]), // a day off for them
      hoursByDate: new Map(),
      todayISO: "2026-08-12",
    });
    expect(missing).toEqual([]);
  });

  it("treats a day covered by PAID TIME OFF as reported", () => {
    const missing = missingWorkdays({
      standardMinutesByDate: standard(["2026-08-10", "2026-08-11"]),
      hoursByDate: new Map([["2026-08-10", 8], ["2026-08-11", 8]]), // Tue was PTO
      todayISO: "2026-08-12",
    });
    expect(missing).toEqual([]);
  });

  it("checks every day of a week that is entirely in the past", () => {
    const missing = missingWorkdays({
      standardMinutesByDate: standard(WEEK),
      hoursByDate: new Map([["2026-08-10", 8]]),
      todayISO: "2026-08-20",
    });
    expect(missing).toEqual(["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]);
  });
});

// ---------------------------------------------------------------------------
// THE SUMMARY STRIP — what the three cells read.
// ---------------------------------------------------------------------------

describe("weekSummary", () => {
  const args = (entries: readonly MyHoursEntry[], policy = FEDERAL, todayISO = "2026-08-20") => ({
    entries,
    policy,
    standardMinutesByDate: new Map(
      ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"].map((d) => [d, 480] as const),
    ),
    todayISO,
  });

  it("adds paid time off to REGULAR without letting it create overtime", () => {
    // 40 worked + a paid holiday. Regular is 48 — capping it at 40 would short the figure by a day.
    const entries = [
      ...["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"].map((workDate) =>
        row({ workDate, startTime: "08:00", endTime: "16:00" }),
      ),
      off({ workDate: "2026-08-15", kind: "holiday", minutes: 480 }),
    ];
    const s = weekSummary(args(entries));
    expect(s.workedHours).toBe(40);
    expect(s.timeOffHours).toBe(8);
    expect(s.overtimeHours).toBe(0);
    expect(s.regularHours).toBe(48);
  });

  it("splits worked hours into regular and overtime, and regular never includes overtime", () => {
    const entries = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"].map((workDate) =>
      row({ workDate, startTime: "08:00", endTime: "18:00" }),
    );
    const s = weekSummary(args(entries, CALIFORNIA));
    expect(s.workedHours).toBe(50);
    expect(s.overtimeHours).toBe(10); // daily, not weekly
    expect(s.regularHours).toBe(40);
    expect(s.rulePhrase).toBe("past 8h a day or 40h this week");
  });

  it("counts a break out of the paid total", () => {
    const s = weekSummary(
      args([
        row({ workDate: "2026-08-10", startTime: "08:00", endTime: "12:00" }),
        row({ workDate: "2026-08-10", kind: "break", startTime: "12:00", endTime: "12:30" }),
        row({ workDate: "2026-08-10", startTime: "12:30", endTime: "16:30" }),
      ]),
    );
    expect(s.workedHours).toBe(8);
    expect(s.breakHours).toBeCloseTo(0.5, 5);
  });

  it("names the days that are missing, so the cell can say which", () => {
    const s = weekSummary(args([row({ workDate: "2026-08-10", startTime: "08:00", endTime: "16:00" })]));
    expect(s.missingDays).toEqual(["2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14"]);
  });

  it("is all zeroes and no missing days for a week nobody has reached yet", () => {
    const s = weekSummary(args([], FEDERAL, "2026-08-01"));
    expect(s).toMatchObject({ workedHours: 0, overtimeHours: 0, regularHours: 0, timeOffHours: 0 });
    expect(s.missingDays).toEqual([]);
  });

  it("ignores a running shift's incomplete stretch in the totals rather than guessing", () => {
    const s = weekSummary(args([row({ workDate: "2026-08-10", startTime: "08:00", endTime: null, running: true })]));
    expect(s.workedHours).toBe(0);
  });

  // ...and SAYS SO. My day counts the stretch the technician is standing in (day-segments.ts) and
  // this does not, so at 3pm the two screens stated different totals for the same day with nothing
  // on either to explain the gap. The figure stays a timesheet figure; the summary carries the fact
  // that a shift is still open so the headline can qualify itself.
  it("reports that a shift is still running, so the headline can say why it is short", () => {
    const s = weekSummary(args([row({ workDate: "2026-08-10", startTime: "08:00", endTime: null, running: true })]));
    expect(s.shiftRunning).toBe(true);
  });

  it("reports no running shift on a week that is entirely clocked out", () => {
    const s = weekSummary(args([row({ workDate: "2026-08-10", startTime: "08:00", endTime: "16:00" })]));
    expect(s.shiftRunning).toBe(false);
  });
});
