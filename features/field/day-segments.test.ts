/**
 * The day summary's maths. Three things the rows do not give you for free, and each of them is a
 * way this panel could quietly under-report a man's own day back to him.
 */
import { describe, it, expect } from "vitest";
import { daySummary, hoursClock } from "./day-segments";
import type { MyHoursEntry } from "./my-hours-derive";

const TODAY = "2026-08-04";
const NOW = new Date(`${TODAY}T09:05:00`);

const row = (over: Partial<MyHoursEntry> = {}): MyHoursEntry =>
  ({
    id: "e1",
    techUserId: "user-1",
    jobId: null,
    workDate: TODAY,
    kind: "shop",
    startTime: "07:42",
    endTime: "08:30",
    note: "",
    src: "clock",
    status: "draft",
    running: false,
    approvedAt: null,
    createdAt: `${TODAY}T07:42:00.000Z`,
    ...over,
  }) as MyHoursEntry;

const noJobs = () => null;

describe("hoursClock", () => {
  it.each([
    [0, "0:00"],
    [1.55, "1:33"],
    [6.6333, "6:38"],
    [-1, "0:00"],
  ])("renders %s hours as %s", (h, expected) => {
    expect(hoursClock(h)).toBe(expected);
  });
});

describe("daySummary", () => {
  it("keeps only today's rows — the list carries twelve weeks", () => {
    const s = daySummary([row(), row({ id: "old", workDate: "2026-07-30" })], TODAY, NOW, noJobs);
    expect(s.segments).toHaveLength(1);
  });

  // The server orders a day by (work_date, id) — UUID order, which is no order at all.
  it("puts the day back in the order it happened", () => {
    const s = daySummary(
      [
        row({ id: "c", startTime: "08:45", endTime: null }),
        row({ id: "a", startTime: "07:42", endTime: "08:30" }),
        row({ id: "b", kind: "break", startTime: "08:30", endTime: "08:45" }),
      ],
      TODAY,
      NOW,
      noJobs,
    );
    expect(s.segments.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(s.dayStart).toBe("7:42a");
  });

  // entryHours returns 0 for a row with no endTime, so a naive sum omits the stretch he is
  // standing in. At 9:05 the 8:45 row is twenty minutes old and those minutes are his.
  it("measures the RUNNING stretch against now instead of counting it as nothing", () => {
    const s = daySummary([row({ startTime: "08:45", endTime: null })], TODAY, NOW, noJobs);
    expect(s.segments[0]?.running).toBe(true);
    expect(s.segments[0]?.hours).toBeCloseTo(20 / 60, 5);
    expect(s.workedHours).toBeCloseTo(20 / 60, 5);
  });

  it("shows a running stretch with an open span rather than a made-up end", () => {
    const s = daySummary([row({ startTime: "08:45", endTime: null })], TODAY, NOW, noJobs);
    expect(s.segments[0]?.span).toBe("8:45a –");
  });

  // Break is the only unpaid kind. That one sentence is the whole policy, and the office has to
  // be able to defend it — so break time is totalled apart, never folded into "worked".
  it("keeps break out of the worked total and reports it separately", () => {
    const s = daySummary(
      [
        row({ id: "a", startTime: "07:42", endTime: "08:30" }),
        row({ id: "b", kind: "break", startTime: "08:30", endTime: "08:45" }),
      ],
      TODAY,
      NOW,
      noJobs,
    );
    expect(hoursClock(s.workedHours)).toBe("0:48");
    expect(hoursClock(s.breakHours)).toBe("0:15");
  });

  it("names a job segment when the agenda knows it, and plainly when it does not", () => {
    const rows = [row({ kind: "job", jobId: "job-1" })];
    expect(daySummary(rows, TODAY, NOW, () => "#JOB-2541 Delgado").segments[0]?.label).toBe(
      "#JOB-2541 Delgado",
    );
    expect(daySummary(rows, TODAY, NOW, noJobs).segments[0]?.label).toBe("Job");
  });

  it("answers with an empty day rather than nothing when no rows are today's", () => {
    const s = daySummary([], TODAY, NOW, noJobs);
    expect(s).toEqual({ segments: [], dayStart: null, workedHours: 0, breakHours: 0 });
  });

  // Device clock behind the shop's: a negative stretch is a skew artefact, not information.
  it("clamps a future start to zero instead of subtracting from the day", () => {
    const s = daySummary([row({ startTime: "23:00", endTime: null })], TODAY, NOW, noJobs);
    expect(s.segments[0]?.hours).toBe(0);
  });
});
