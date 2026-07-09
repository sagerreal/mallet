import { describe, it, expect } from "vitest";
import { mkEntry, mkJob, mkLead } from "./test-factories";
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
    expect(opts.at(-1)?.label).toBe("8:00pm");
    // 6:00 → 20:00 inclusive at 0.25h = 14h × 4 + 1 = 57 options
    expect(opts).toHaveLength(57);
  });
});
