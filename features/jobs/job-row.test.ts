import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import { mkJob, mkVisit, mkTech } from "./test-factories";
import { jobWhenLabel, jobStatusView, jobCrewTech } from "./job-row";

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

describe("jobStatusView — amber is rationed to the states that need the owner", () => {
  it("flags a slot, a live crew, and an unbilled done job as amber", () => {
    expect(jobStatusView("needsSlot", mkJob()).tone).toBe("amber");
    const onsite = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9, status: "onsite" })] });
    const s = jobStatusView("today", onsite);
    expect(s.tone).toBe("amber");
    expect(s.live).toBe(true);
    expect(jobStatusView("doneUnbilled", mkJob()).tone).toBe("amber");
  });

  it("keeps calm states neutral", () => {
    const todayJob = mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 13 })] });
    expect(jobStatusView("today", todayJob).tone).toBe("neutral");
    expect(jobStatusView("thisWeek", mkJob()).tone).toBe("neutral");
    expect(jobStatusView("later", mkJob()).tone).toBe("neutral");
    expect(jobStatusView("done", mkJob()).tone).toBe("neutral");
  });

  it("labels 'Scheduled' for both future bands", () => {
    expect(jobStatusView("thisWeek", mkJob()).label).toBe("Scheduled");
    expect(jobStatusView("later", mkJob()).label).toBe("Scheduled");
  });

  it("labels the archived band 'Archived', neutral", () => {
    const s = jobStatusView("archived", mkJob());
    expect(s.label).toBe("Archived");
    expect(s.tone).toBe("neutral");
  });

  it("needsSlot carries the schedule board href", () => {
    expect(jobStatusView("needsSlot", mkJob()).href).toBe("/jobs?tab=schedule");
  });

  it("other bands do not carry an href", () => {
    expect(jobStatusView("done", mkJob()).href).toBeUndefined();
    expect(jobStatusView("thisWeek", mkJob()).href).toBeUndefined();
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
