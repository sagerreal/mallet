import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import { mkJob, mkVisit, mkTech } from "./test-factories";
import { jobWhenLabel, jobCrewTech } from "./job-row";

describe("jobWhenLabel", () => {
  it("needsSlot reads how long the job has been sold", () => {
    expect(jobWhenLabel("needsSlot", mkJob(), 0).label).toBe("sold today");
    expect(jobWhenLabel("needsSlot", mkJob(), 10).label).toBe("sold 10d ago");
  });

  it("today shows the live on-site pill when the crew is on site", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9, status: "onsite", onsiteAt: "9:04" })] });
    const w = jobWhenLabel("today", j, 0);
    expect(w.live).toBe(true);
    expect(w.onsiteAt).toBe("9:04");
  });

  it("today shows the appointment time when not yet on site", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 13 })] });
    const w = jobWhenLabel("today", j, 0);
    expect(w.live).toBe(false);
    // "Today ·" prefix since Aug 11 — the WHEN column always names the date, never a bare time.
    expect(w.label).toBe("Today · 1p");
  });

  it("done shows the day it was finished", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(-1), techId: "1", start: 9, status: "done" })] });
    expect(jobWhenLabel("done", j, 0).label).toMatch(/^done /);
  });

  it("scheduled bands show the next visit day + time", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(2), techId: "1", start: 10 })] });
    expect(jobWhenLabel("thisWeek", j, 0).label).toMatch(/10a$/);
  });
});

describe("jobWhenLabel — the cell carries the BAND now the Status column is gone", () => {
  it("names how late an overdue job is, in rust", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(-3), techId: "1", start: 9 })] });
    const w = jobWhenLabel("late", j, 0);
    expect(w.label).toBe("3d late \u00b7 Jun 28");
    expect(w.tone).toBe("rust");
  });

  it("measures lateness from the OLDEST outstanding trip, not the newest placed one", () => {
    // A job can carry a finished visit dated AFTER the one still owed — a return trip run out of
    // order, or a follow-up booked before the original was closed. Reading "the next visit" then
    // reports the wrong day and a far smaller number than the truth.
    const j = mkJob({
      visits: [
        mkVisit({ id: "a", date: dPlus(-11), techId: "1", start: 9 }),
        mkVisit({ id: "b", date: dPlus(-1), techId: "1", start: 9, status: "done" }),
      ],
    });
    expect(jobWhenLabel("late", j, 0).label).toBe("11d late \u00b7 Jun 20");
  });

  it("rations amber to the three states that need the owner", () => {
    expect(jobWhenLabel("needsSlot", mkJob(), 4).tone).toBe("amber");
    expect(jobWhenLabel("doneUnbilled", mkJob(), 0).tone).toBe("amber");
    const onsite = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9, status: "onsite", onsiteAt: "9:04" })] });
    expect(jobWhenLabel("today", onsite, 0).live).toBe(true);
  });

  it("leaves the calm bands untoned", () => {
    const todayJob = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 13 })] });
    expect(jobWhenLabel("today", todayJob, 0).tone).toBeUndefined();
    expect(jobWhenLabel("thisWeek", mkJob(), 0).tone).toBeUndefined();
    expect(jobWhenLabel("later", mkJob(), 0).tone).toBeUndefined();
    expect(jobWhenLabel("done", mkJob(), 0).tone).toBeUndefined();
  });

  it("links out of needsSlot ONLY — the one action the row click does not already do", () => {
    // Everything else's action is the job modal, which clicking the row opens. A second arrow
    // would promise a destination that does not exist.
    expect(jobWhenLabel("needsSlot", mkJob(), 4).href).toBe("/jobs?tab=schedule");
    expect(jobWhenLabel("doneUnbilled", mkJob(), 0).href).toBeUndefined();
    expect(jobWhenLabel("late", mkJob({ visits: [mkVisit({ date: dPlus(-3), techId: "1", start: 9 })] }), 0).href).toBeUndefined();
    expect(jobWhenLabel("thisWeek", mkJob(), 0).href).toBeUndefined();
  });
});

describe("jobCrewTech", () => {
  const techs = [mkTech({ id: "1", name: "Carlos Diaz", initials: "CD" }), mkTech({ id: "2", name: "Mike Rivera", initials: "MR" })];

  it("returns today's crew for a today job", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "2", start: 9 })] });
    expect(jobCrewTech("today", j, techs)?.id).toBe("2");
  });

  it("returns the done crew for a finished job", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(-1), techId: "1", start: 9, status: "done" })] });
    expect(jobCrewTech("done", j, techs)?.id).toBe("1");
  });

  it("returns null when no visit carries a crew", () => {
    expect(jobCrewTech("needsSlot", mkJob({ visits: [] }), techs)).toBeNull();
  });
});

// Owen, Aug 11: "the WHEN should show a specific date and time not just the time." The old label
// printed a bare weekday — a May 8 row read "Fri 11a", indistinguishable from this Friday, which
// is how 493 stale seeded jobs impersonated the coming week.
describe("jobWhenLabel — a specific date, never a bare weekday", () => {
  it("scheduled bands print month + day + time", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(2), techId: "1", start: 10 })] });
    expect(jobWhenLabel("thisWeek", j, 0).label).toMatch(/^[A-Z][a-z]{2} \d{1,2} · 10a$/);
  });

  it("today prints the word Today with the time — specific, and still scannable", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 13 })] });
    expect(jobWhenLabel("today", j, 0).label).toBe("Today · 1p");
  });

  it("done prints the real date it finished", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(-1), techId: "1", start: 9, status: "done" })] });
    expect(jobWhenLabel("done", j, 0).label).toMatch(/^done [A-Z][a-z]{2} \d{1,2}$/);
  });

  it("a half-planned slot names its pencilled-in date, not a weekday", () => {
    const j = mkJob({ visits: [mkVisit({ date: dPlus(3), techId: null, start: 11 })] });
    expect(jobWhenLabel("needsSlot", j, 0).label).toMatch(/^[A-Z][a-z]{2} \d{1,2} · 11a · no crew$/);
  });
});
