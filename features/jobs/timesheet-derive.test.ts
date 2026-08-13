import { describe, it, expect } from "vitest";
import { mkEntry, mkJob, mkLead, mkVisit } from "./test-factories";
import {
  tsAddDays,
  tsWeekStart,
  tsWeekDates,
  tsDayShort,
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
  tsKindChange,
} from "./timesheet-derive";
import {
  TS_KINDS,
  TS_TIME_OFF_KEYS,
  TS_TIME_OFF_MINUTES,
  tsMinutesLabel,
} from "./timesheet-constants";

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

  it("splits hours past the shop's weekly line into overtime", () => {
    const entries = Array.from({ length: 6 }, (_, i) =>
      mkEntry({ id: `e${i + 1}`, techId: "3", date: tsAddDays("2026-06-29", i), start: "08:00", end: "16:00" })
    ); // 6 × 8 = 48h
    const r = tsRollup(entries, "3", week, { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null });
    expect(r.paid).toBe(48);
    expect(r.reg).toBe(40);
    expect(r.ot).toBe(8);
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

describe("tsDayShort", () => {
  it("leads with the weekday, so seven of them can be scanned in a row", () => {
    expect(tsDayShort("2026-07-22")).toBe("Wed 22");
    expect(tsDayShort("2026-07-20")).toBe("Mon 20");
  });

  it("does not slip to the previous day in a UTC-negative timezone", () => {
    // Parsed at noon for exactly this reason — midnight would land on the 21st west of UTC.
    expect(tsDayShort("2026-07-22")).toContain("22");
  });
});

// ---------------------------------------------------------------------------
// THE OFFICE'S OVERTIME. This grid is where a week is approved and pushed to QuickBooks, and it
// computed overtime from a compiled-in forty while the technician's own screen computed it from the
// shop's configured rule. Three separate wrong answers came out of that, and each one is below.
// ---------------------------------------------------------------------------

describe("the office rollup obeys the shop's overtime rule", () => {
  const WEEK = tsWeekDates("2026-06-29");
  const CALIFORNIA = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: 480 };
  const FEDERAL = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null };

  /** n days of `hours` each, starting Monday. */
  const days = (n: number, hours: number) =>
    Array.from({ length: n }, (_, i) =>
      mkEntry({
        id: `d${i}`,
        techId: "3",
        date: tsAddDays("2026-06-29", i),
        start: "07:00",
        end: `${String(7 + hours).padStart(2, "0")}:00`,
      }),
    );

  it("catches the daily overtime a weekly-only rule cannot see", () => {
    // Four ten-hour days: 40 hours worked, so a weekly-40 rule reports nothing — and in California
    // the man is owed EIGHT hours. This is the figure the office was signing off wrong.
    const r = tsRollup(days(4, 10), "3", WEEK, CALIFORNIA);
    expect(r.paid).toBe(40);
    expect(r.ot).toBe(8);
    expect(r.reg).toBe(32);
  });

  it("never counts the same hour twice when both thresholds are crossed", () => {
    // Five ten-hour days: 10h daily overage, and 50 is also ten past forty — the SAME ten hours.
    const r = tsRollup(days(5, 10), "3", WEEK, CALIFORNIA);
    expect(r.ot).toBe(10);
    expect(r.reg).toBe(40);
  });

  it("still gets a federal week right", () => {
    const r = tsRollup(days(6, 8), "3", WEEK, FEDERAL);
    expect(r.paid).toBe(48);
    expect(r.ot).toBe(8);
    expect(r.reg).toBe(40);
  });

  it("defaults to the federal floor when no rule is passed", () => {
    // The parameter is optional so every existing caller keeps working; the default is the law where
    // no state rule applies, never a blank.
    expect(tsRollup(days(6, 8), "3", WEEK).ot).toBe(8);
  });

  it("names the rule it used, so the approver can defend the figure", () => {
    expect(tsRollup([], "3", WEEK, CALIFORNIA).rulePhrase).toBe("past 8h a day or 40h this week");
    expect(tsRollup([], "3", WEEK, FEDERAL).rulePhrase).toBe("past 40h this week");
  });
});

describe("paid time off on the office grid", () => {
  const WEEK = tsWeekDates("2026-06-29");
  const FEDERAL = { weeklyThresholdMinutes: 2400, dailyThresholdMinutes: null };
  const holiday = mkEntry({
    id: "hol",
    techId: "3",
    date: "2026-07-04",
    kind: "holiday",
    start: null,
    end: null,
    minutes: 480,
  });
  /** Monday to Friday, eight hours each — a full forty WORKED. */
  const fullWeek = Array.from({ length: 5 }, (_, i) =>
    mkEntry({ id: `w${i}`, techId: "3", date: tsAddDays("2026-06-29", i), start: "08:00", end: "16:00" }),
  );

  it("counts a day off's hours at all — they used to total ZERO here", () => {
    // A time-off row carries a LENGTH and no punch times, and the start/end subtraction returned
    // nothing for it: eight paid hours invisible on the screen that approves the week.
    expect(tsHours(holiday)).toBe(8);
    expect(tsPaid(holiday)).toBe(8);
  });

  it("does not let a paid holiday create overtime", () => {
    // 40 worked + 8 holiday = 48 PAID, and nobody worked a 41st hour.
    const r = tsRollup([...fullWeek, holiday], "3", WEEK, FEDERAL);
    expect(r.paid).toBe(48);
    expect(r.ot).toBe(0);
  });

  it("reports regular UNCAPPED, because 48 is what the shop is about to pay", () => {
    const r = tsRollup([...fullWeek, holiday], "3", WEEK, FEDERAL);
    expect(r.reg).toBe(48);
  });

  it("never calls a day off 'unfinished' — it has no end time by construction", () => {
    // The bare `!end` test named every holiday as a day the office had to go fix, and no amount of
    // fixing would have changed it. Same kind-blindness the server's approval predicate had.
    expect(tsIsUnfinished(holiday)).toBe(false);
    expect(tsUnfinishedDays([holiday], "3", WEEK)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE OFFICE ENTERING TIME OFF. With "Techs can edit their own times" defaulting OFF, this grid is
// the ONLY place in the product a holiday can be recorded — so the kind picker has to offer it, and
// changing kind has to rewrite the row's SHAPE or the database refuses the write.
// ---------------------------------------------------------------------------

describe("changing a row's kind", () => {
  const worked = mkEntry({ id: "w", techId: "3", date: "2026-06-29", start: "08:00", end: "16:00" });
  const dayOff = mkEntry({
    id: "o",
    techId: "3",
    date: "2026-06-29",
    kind: "holiday",
    start: null,
    end: null,
    minutes: 480,
  });

  it("clears the punch times when worked time becomes a day off", () => {
    // The two shapes are mutually exclusive by constraint. Leaving start/end set would have the
    // domain refuse the write, and the office would be clicking a control that does nothing.
    const patch = tsKindChange(worked, "pto");
    expect(patch).toMatchObject({ kind: "pto", start: null, end: null, minutes: 480, running: false });
  });

  it("gives a day off real times when it becomes worked time again", () => {
    const patch = tsKindChange(dayOff, "shop");
    expect(patch.minutes).toBeNull();
    expect(patch.start).toBe("08:00");
    expect(patch.end).toBe("16:00");
  });

  it("does not disturb the shape when both kinds are clocked", () => {
    expect(tsKindChange(worked, "travel")).toEqual({ kind: "travel" });
  });

  it("does not disturb the shape between two time-off kinds", () => {
    // Holiday → Sick keeps the length he already entered rather than resetting it to a default day.
    expect(tsKindChange(dayOff, "sick")).toEqual({ kind: "sick" });
  });

  it("never leaves a running flag set across a conversion", () => {
    const running = mkEntry({ id: "r", techId: "3", date: "2026-06-29", start: "08:00", end: null, running: true });
    expect(tsKindChange(running, "vacation").running).toBe(false);
  });

  it("defaults a new day off to a standard working day, not to zero", () => {
    // Zero hours of PTO is not a thing anybody means, and it would read as recorded.
    expect(tsKindChange(worked, "vacation").minutes).toBe(480);
  });
});

describe("labels for time off", () => {
  it("has a label for every time-off kind — a missing one rendered as `undefined` in the grid", () => {
    for (const kind of TS_TIME_OFF_KEYS) {
      expect(TS_KINDS[kind]).toBeTruthy();
    }
  });

  it("reads a length in hours and half hours", () => {
    expect(tsMinutesLabel(480)).toBe("8h");
    expect(tsMinutesLabel(450)).toBe("7h 30m");
    expect(tsMinutesLabel(30)).toBe("30m");
  });

  it("offers half-hour steps from 30 minutes to twelve hours", () => {
    // Half days and a two-and-a-half hour appointment are how time off is actually taken.
    expect(TS_TIME_OFF_MINUTES[0]).toBe(30);
    expect(TS_TIME_OFF_MINUTES.at(-1)).toBe(720);
    expect(TS_TIME_OFF_MINUTES).toContain(240);
  });
});
