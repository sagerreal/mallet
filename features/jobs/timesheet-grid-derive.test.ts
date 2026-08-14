import { describe, it, expect } from "vitest";
import type { TimeEntry } from "@/lib/store/types";
import {
  tsInitials,
  tsDayHours,
  tsOtDays,
  tsIssueCount,
  tsRowStatus,
  tsCrewRows,
  tsGridCounts,
  tsFilterRows,
} from "./timesheet-grid-derive";

const WEEK = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
const CA = { weeklyThresholdMinutes: 40 * 60, dailyThresholdMinutes: 8 * 60 };
const FED = { weeklyThresholdMinutes: 40 * 60, dailyThresholdMinutes: null };

let seq = 0;
const entry = (over: Partial<TimeEntry> = {}): TimeEntry =>
  ({
    id: `e${seq++}`,
    techId: "t1",
    date: "2026-08-10",
    kind: "job",
    start: "08:00",
    end: "16:00",
    jobId: null,
    note: "",
    status: "draft",
    running: false,
    minutes: null,
    ...over,
  }) as TimeEntry;

describe("tsInitials", () => {
  it("takes first and last for a full name", () => {
    expect(tsInitials("Carlos Rivas")).toBe("CR");
  });
  it("takes two letters from a single word — a username is still a person", () => {
    expect(tsInitials("owenduggan")).toBe("OW");
  });
  it("ignores the middle name rather than showing three letters in a two-letter circle", () => {
    expect(tsInitials("Mary Jane Watson")).toBe("MW");
  });
  it("never renders empty", () => {
    expect(tsInitials("   ")).toBe("?");
  });
});

describe("tsDayHours", () => {
  it("sums a day's entries and leaves untouched days null, not zero", () => {
    // null vs 0 is the whole point: "nothing reported" and "reported nothing" are different facts,
    // and the grid draws them differently.
    const es = [
      entry({ date: "2026-08-10", start: "08:00", end: "12:00" }),
      entry({ date: "2026-08-10", start: "13:00", end: "16:00" }),
    ];
    const d = tsDayHours(es, "t1", WEEK);
    expect(d[0]).toBe(7);
    expect(d[1]).toBeNull();
  });

  it("excludes another technician's hours", () => {
    const es = [entry({ techId: "t2", date: "2026-08-10" })];
    expect(tsDayHours(es, "t1", WEEK)[0]).toBeNull();
  });

  it("leaves unpaid breaks out of the day figure", () => {
    const es = [
      entry({ date: "2026-08-10", start: "08:00", end: "16:00" }),
      entry({ date: "2026-08-10", kind: "break", start: "12:00", end: "12:30" }),
    ];
    // Whatever the break contributes, the day cannot exceed the worked span.
    expect(tsDayHours(es, "t1", WEEK)[0]).toBeLessThanOrEqual(8);
  });
});

describe("tsOtDays", () => {
  it("flags a day past the shop's DAILY rule", () => {
    const es = [entry({ date: "2026-08-11", start: "07:00", end: "16:30" })]; // 9.5h
    expect([...tsOtDays(es, "t1", WEEK, CA)]).toEqual([1]);
  });

  it("flags nothing on the federal floor — no daily rule is not a missing feature", () => {
    const es = [entry({ date: "2026-08-11", start: "07:00", end: "19:00" })];
    expect(tsOtDays(es, "t1", WEEK, FED).size).toBe(0);
  });

  it("a day exactly ON the threshold is not overtime", () => {
    const es = [entry({ date: "2026-08-10", start: "08:00", end: "16:00" })]; // exactly 8
    expect(tsOtDays(es, "t1", WEEK, CA).size).toBe(0);
  });
});

describe("tsIssueCount", () => {
  it("counts a day whose clock never stopped", () => {
    const es = [entry({ date: "2026-08-12", start: "07:00", end: null, running: false })];
    expect(tsIssueCount(es, "t1", WEEK)).toBe(1);
  });

  it("counts a day once even when it has several problems", () => {
    // The column says "this row needs you". Two flags on one day is still one day to look at.
    const es = [
      entry({ date: "2026-08-12", start: "07:00", end: null, running: false }),
      entry({ date: "2026-08-12", start: "08:00", end: null, running: false }),
    ];
    expect(tsIssueCount(es, "t1", WEEK)).toBe(1);
  });

  it("is zero for a clean week", () => {
    expect(tsIssueCount([entry({ start: "08:00", end: "16:00" })], "t1", WEEK)).toBe(0);
  });
});

describe("tsRowStatus", () => {
  it("no entries is `empty`, never a zero-hour week", () => {
    expect(tsRowStatus(false, 0, false)).toBe("empty");
  });
  it("approved outranks submitted", () => {
    expect(tsRowStatus(true, 3, true)).toBe("approved");
  });
  it("submitted sits between draft and approved", () => {
    expect(tsRowStatus(false, 3, true)).toBe("submitted");
  });
  it("anything else needs review", () => {
    expect(tsRowStatus(false, 3, false)).toBe("review");
  });
});

describe("tsCrewRows", () => {
  const techs = [
    { id: "t1", name: "Carlos Rivas" },
    { id: "t2", name: "Dwayne Ellis" },
  ];

  it("gives EVERY technician a row, including one who reported nothing", () => {
    // The grid exists to answer "who hasn't reported yet". An absent row answers by omission.
    const rows = tsCrewRows({
      entries: [entry({ techId: "t1" })],
      techs,
      weekDates: WEEK,
      submittedTechIds: new Set(),
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]?.status).toBe("empty");
    expect(rows[1]?.paid).toBe(0);
  });

  it("carries the submitted flag through to the status", () => {
    const rows = tsCrewRows({
      entries: [entry({ techId: "t1" })],
      techs,
      weekDates: WEEK,
      submittedTechIds: new Set(["t1"]),
    });
    expect(rows[0]?.status).toBe("submitted");
  });

  it("reports overtime from the shop's policy, not a compiled-in forty", () => {
    const es = [
      entry({ techId: "t1", date: "2026-08-10", start: "07:00", end: "17:00" }),
      entry({ techId: "t1", date: "2026-08-11", start: "07:00", end: "17:00" }),
    ];
    const fed = tsCrewRows({ entries: es, techs, weekDates: WEEK, policy: FED, submittedTechIds: new Set() });
    const ca = tsCrewRows({ entries: es, techs, weekDates: WEEK, policy: CA, submittedTechIds: new Set() });
    expect(fed[0]?.ot).toBe(0); // 20h in the week — nowhere near the weekly floor
    expect(ca[0]?.ot).toBeGreaterThan(0); // two ten-hour days IS overtime in California
  });
});

describe("tsGridCounts / tsFilterRows", () => {
  const rows = tsCrewRows({
    entries: [
      entry({ techId: "t1", date: "2026-08-10" }),
      entry({ techId: "t2", date: "2026-08-12", start: "07:00", end: null, running: false }),
      entry({ techId: "t3", date: "2026-08-10", status: "approved" }),
    ],
    techs: [
      { id: "t1", name: "Carlos Rivas" },
      { id: "t2", name: "Dwayne Ellis" },
      { id: "t3", name: "Tanya Brooks" },
      { id: "t4", name: "Vic Prasad" },
    ],
    weekDates: WEEK,
    submittedTechIds: new Set(),
  });

  it("counts each chip off the rows on screen, never a second query", () => {
    const c = tsGridCounts(rows);
    expect(c.all).toBe(4);
    expect(c.approved).toBe(1);
    expect(c.issues).toBe(1);
  });

  it("`all` is the absence of a filter — an empty week still shows", () => {
    expect(tsFilterRows(rows, "all", "")).toHaveLength(4);
  });

  it("filters to the rows that need an approver", () => {
    const out = tsFilterRows(rows, "review", "").map((r) => r.techId);
    expect(out).toContain("t1");
    expect(out).not.toContain("t3");
  });

  it("search matches the name, case-insensitively", () => {
    expect(tsFilterRows(rows, "all", "tany").map((r) => r.techId)).toEqual(["t3"]);
  });

  it("search and chip apply together, not either/or", () => {
    expect(tsFilterRows(rows, "approved", "carlos")).toHaveLength(0);
  });
});
