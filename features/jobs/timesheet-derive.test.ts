import { describe, it, expect } from "vitest";
import { mkEntry, mkJob, mkLead, mkVisit } from "./test-factories";
import {
  tsAddDays,
  tsWeekStart,
  tsWeekDates,
  tsHours,
  tsPaid,
  tsRollup,
  tsMoney,
  tsLabel,
  tsT12,
  tsTimeOpts,
  tsIsUnfinished,
  tsIsImplausible,
  tsUnfinishedDays,
  tsUnrecordedDays,
  tsDayLabel,
} from "./timesheet-derive";
import { FULL_TIME_HOURS_PER_WEEK } from "./timesheet-constants";

describe("week math", () => {
  it("tsWeekStart returns the Monday of the containing week", () => {
    // 2026-07-01 is a Wednesday → Monday is 2026-06-29
    expect(tsWeekStart("2026-07-01")).toBe("2026-06-29");
    // a Monday maps to itself
    expect(tsWeekStart("2026-06-29")).toBe("2026-06-29");
    // a Sunday maps back to that week's Monday
    expect(tsWeekStart("2026-07-05")).toBe("2026-06-29");
  });

  it("tsWeekDates yields 7 consecutive days Mon..Sun", () => {
    const dates = tsWeekDates("2026-06-29");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-06-29");
    expect(dates[6]).toBe("2026-07-05");
  });

  it("tsAddDays crosses month boundaries", () => {
    expect(tsAddDays("2026-06-30", 1)).toBe("2026-07-01");
    expect(tsAddDays("2026-07-01", -1)).toBe("2026-06-30");
  });
});

describe("tsHours / tsPaid", () => {
  it("computes worked hours from start/end", () => {
    expect(tsHours(mkEntry({ start: "08:00", end: "12:30" }))).toBe(4.5);
  });
  it("returns 0 for a running or endless entry", () => {
    expect(tsHours(mkEntry({ end: null }))).toBe(0);
  });
  it("never returns negative hours", () => {
    expect(tsHours(mkEntry({ start: "12:00", end: "08:00" }))).toBe(0);
  });
  it("excludes an unpaid break from paid hours", () => {
    expect(tsPaid(mkEntry({ kind: "break", start: "12:00", end: "12:30" }))).toBe(0);
    expect(tsPaid(mkEntry({ kind: "job", start: "12:00", end: "12:30" }))).toBe(0.5);
  });
});

describe("tsRollup — the 40h overtime split", () => {
  const week = tsWeekDates("2026-06-29");

  it("keeps all hours regular below the full-time line", () => {
    const entries = [
      mkEntry({ id: "e1", techId: "3", date: "2026-06-29", start: "08:00", end: "16:00" }), // 8h
      mkEntry({ id: "e2", techId: "3", date: "2026-06-30", start: "08:00", end: "16:00" }), // 8h
    ];
    const r = tsRollup(entries, "3", week);
    expect(r.paid).toBe(16);
    expect(r.reg).toBe(16);
    expect(r.ot).toBe(0);
  });

  it("splits hours past the full-time line into overtime", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      mkEntry({ id: `e${i + 1}`, techId: "3", date: tsAddDays("2026-06-29", i), start: "08:00", end: "16:00" })
    ); // 6 × 8 = 48h
    const r = tsRollup(entries, "3", week);
    expect(r.paid).toBe(48);
    expect(r.reg).toBe(FULL_TIME_HOURS_PER_WEEK);
    expect(r.ot).toBe(48 - FULL_TIME_HOURS_PER_WEEK);
  });

  it("is approved only when every entry is approved", () => {
    const approved = mkEntry({ id: "e1", techId: "3", date: "2026-06-29", status: "approved" });
    const draft = mkEntry({ id: "e2", techId: "3", date: "2026-06-30", status: "draft" });
    expect(tsRollup([approved, draft], "3", week).approved).toBe(false);
    expect(tsRollup([approved], "3", week).approved).toBe(true);
  });

  it("only counts the given tech's entries within the week", () => {
    const entries = [
      mkEntry({ id: "e1", techId: "3", date: "2026-06-29", start: "08:00", end: "12:00" }),
      mkEntry({ id: "e2", techId: "4", date: "2026-06-29", start: "08:00", end: "18:00" }), // other tech
      mkEntry({ id: "e3", techId: "3", date: "2026-07-20", start: "08:00", end: "18:00" }), // other week
    ];
    expect(tsRollup(entries, "3", week).paid).toBe(4);
  });
});

describe("tsRollup — the summary the office signs off on", () => {
  const week = tsWeekDates("2026-06-29");

  it("reports regular + overtime that add back up to the paid total", () => {
    const entries = [
      mkEntry({ id: "e1", techId: "3", date: "2026-06-29", start: "07:00", end: "17:00" }), // 10h
      mkEntry({ id: "e2", techId: "3", date: "2026-06-30", start: "07:00", end: "17:00" }), // 10h
      mkEntry({ id: "e3", techId: "3", date: "2026-07-01", start: "07:00", end: "17:00" }), // 10h
      mkEntry({ id: "e4", techId: "3", date: "2026-07-02", start: "07:00", end: "18:00" }), // 11h
    ];
    const r = tsRollup(entries, "3", week);

    expect(r.paid).toBe(41);
    expect(r.reg).toBe(40);
    expect(r.ot).toBe(1);
    expect(tsMoney(r.reg + r.ot)).toBe(r.paid);
  });

  it("keeps an unpaid break out of every figure in the summary", () => {
    const worked = mkEntry({ id: "e1", techId: "3", date: "2026-06-29", start: "08:00", end: "16:00" });
    const lunch = mkEntry({ id: "e2", techId: "3", date: "2026-06-29", kind: "break", start: "12:00", end: "12:30" });
    const r = tsRollup([worked, lunch], "3", week);

    expect(r.paid).toBe(8);
    expect(r.reg).toBe(8);
    expect(r.ot).toBe(0);
    expect(r.count).toBe(2);
  });

  it("counts a running entry as no hours — it has no duration yet", () => {
    const running = mkEntry({ id: "e1", techId: "3", date: "2026-06-29", start: "08:00", end: null, running: true });
    expect(tsRollup([running], "3", week).paid).toBe(0);
  });
});

describe("tsIsUnfinished / tsUnfinishedDays — what blocks approval", () => {
  const week = tsWeekDates("2026-06-29");

  it("treats a running entry and an end-less entry alike", () => {
    expect(tsIsUnfinished(mkEntry({ end: null, running: true }))).toBe(true);
    expect(tsIsUnfinished(mkEntry({ end: null }))).toBe(true);
    expect(tsIsUnfinished(mkEntry({ end: "16:00" }))).toBe(false);
  });

  it("names each offending day once, in week order", () => {
    const entries = [
      mkEntry({ id: "e1", techId: "3", date: "2026-07-02", end: null, running: true }),
      mkEntry({ id: "e2", techId: "3", date: "2026-07-02", end: null }), // same day, second offender
      mkEntry({ id: "e3", techId: "3", date: "2026-06-30", end: null, running: true }),
      mkEntry({ id: "e4", techId: "3", date: "2026-06-29", end: "16:00" }), // finished
    ];
    expect(tsUnfinishedDays(entries, "3", week)).toEqual(["2026-06-30", "2026-07-02"]);
  });

  it("ignores other crew, other weeks and already-approved rows", () => {
    const entries = [
      mkEntry({ id: "e1", techId: "4", date: "2026-06-29", end: null, running: true }),
      mkEntry({ id: "e2", techId: "3", date: "2026-07-20", end: null, running: true }),
      mkEntry({ id: "e3", techId: "3", date: "2026-06-29", end: null, status: "approved" }),
    ];
    expect(tsUnfinishedDays(entries, "3", week)).toEqual([]);
  });
});

describe("tsUnrecordedDays — the days nobody wrote anything down", () => {
  const week = tsWeekDates("2026-06-29");
  const jobOn = (date: string, techId: string) =>
    mkJob({ id: `job-${date}`, visits: [mkVisit({ id: `v-${date}`, date, techId })] });

  it("flags a day the crew was scheduled on a job and logged nothing", () => {
    const jobs = [jobOn("2026-06-30", "3")];
    expect(tsUnrecordedDays(jobs, "3", week, [])).toEqual(["2026-06-30"]);
  });

  it("says nothing about a day that has hours on it", () => {
    const jobs = [jobOn("2026-06-30", "3")];
    const entries = [mkEntry({ id: "e1", techId: "3", date: "2026-06-30", start: "08:00", end: "16:00" })];
    expect(tsUnrecordedDays(jobs, "3", week, entries)).toEqual([]);
  });

  it("says nothing about a day with no work scheduled — a day off is not an omission", () => {
    expect(tsUnrecordedDays([jobOn("2026-06-30", "4")], "3", week, [])).toEqual([]);
    expect(tsUnrecordedDays([], "3", week, [])).toEqual([]);
  });

  it("ignores archived jobs", () => {
    const jobs = [{ ...jobOn("2026-06-30", "3"), archived: true }];
    expect(tsUnrecordedDays(jobs, "3", week, [])).toEqual([]);
  });
});

describe("tsDayLabel", () => {
  it("names a day the same way wherever it appears", () => {
    // 2026-07-02 is a Thursday. Parsed at noon so a negative UTC offset can't roll it back a day.
    expect(tsDayLabel("2026-07-02")).toContain("Thu");
    expect(tsDayLabel("2026-07-02")).toContain("2");
    expect(tsDayLabel("2026-07-02", "long")).toContain("Thursday");
  });
});

describe("tsMoney", () => {
  it("rounds to two decimal places", () => {
    expect(tsMoney(1.236)).toBe(1.24);
    expect(tsMoney(1.234)).toBe(1.23);
    expect(tsMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe("tsLabel", () => {
  const jobs = [mkJob({ id: "1", title: "Whole-house PEX repipe", leadId: "1" })];
  const leads = [mkLead({ id: "1", name: "Dave Chen" })];

  it("labels a job entry as title · customer", () => {
    expect(tsLabel(mkEntry({ kind: "job", jobId: "1" }), jobs, leads)).toBe("Whole-house PEX repipe · Dave Chen");
  });
  it("labels non-job kinds with their fixed phrase", () => {
    expect(tsLabel(mkEntry({ kind: "travel" }), jobs, leads)).toBe("Travel between jobs");
    expect(tsLabel(mkEntry({ kind: "break" }), jobs, leads)).toBe("Lunch / break");
  });
});

describe("tsT12 / tsTimeOpts", () => {
  it("formats decimal hours in 12h clock", () => {
    expect(tsT12(8)).toBe("8:00am");
    expect(tsT12(13.5)).toBe("1:30pm");
    expect(tsT12(12)).toBe("12:00pm");
    expect(tsT12(0)).toBe("12:00am");
  });
  it("spans the configured picker window at quarter-hour steps", () => {
    const opts = tsTimeOpts();
    expect(opts[0]?.label).toBe("6:00am");
    // Reaches the END OF THE DAY, not the end of an office shift. The window used to stop at 8pm,
    // which made the emergency call unfixable: the office was told by the approval refusal to stop
    // a segment that ran to 23:30, with no option in the list later than 20:00.
    expect(opts.at(-1)?.label).toBe("11:45pm");
    // 6:00 → 23:45 inclusive at 0.25h = 17.75h × 4 + 1 = 72 options
    expect(opts).toHaveLength(72);
  });

  it("offers a late-evening end time, so an emergency call can be corrected", () => {
    expect(tsTimeOpts().some((o) => o.label === "11:30pm")).toBe(true);
  });
});

// A reviewer found the break case, and it is the quiet one: break is the ONLY unpaid kind, so a
// break left running swallows the afternoon and the technician is simply short-paid. Nothing else
// objects — the row is FINISHED, so tsIsUnfinished is false, the still-open banner never fires and
// approveWeek accepts it. The only symptom is a small weekly total nobody questions.
describe("tsIsImplausible — a row that is probably a forgotten segment", () => {
  const row = (over: Parameters<typeof mkEntry>[0]) =>
    mkEntry({ date: "2026-07-21", kind: "job", start: "08:00", end: "16:00", ...over });

  it("flags a break that swallowed the afternoon", () => {
    expect(tsIsImplausible(row({ kind: "break", start: "12:00", end: "17:00" }))).toBe(true);
  });

  it("leaves a real lunch alone", () => {
    expect(tsIsImplausible(row({ kind: "break", start: "12:00", end: "12:30" }))).toBe(false);
  });

  it("flags a paid segment longer than one unbroken stretch", () => {
    expect(tsIsImplausible(row({ start: "07:00", end: "20:00" }))).toBe(true);
  });

  it("leaves an ordinary working day alone", () => {
    expect(tsIsImplausible(row({ start: "08:00", end: "16:30" }))).toBe(false);
  });

  it("leaves a long emergency call alone — 10 hours on one job is work, not a mistake", () => {
    expect(tsIsImplausible(row({ start: "14:00", end: "23:30" }))).toBe(false);
  });

  it("says nothing about an unfinished row — that is the still-open banner's job, not this one", () => {
    expect(tsIsImplausible(row({ end: null, running: true }))).toBe(false);
  });
});
