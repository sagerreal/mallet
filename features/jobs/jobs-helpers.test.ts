import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import { mkJob, mkVisit, mkLead, mkTech } from "./test-factories";
import { jobNextVisit, jobMode, custName, jobsUnscheduled, dayLoad } from "./jobs-helpers";

describe("jobNextVisit", () => {
  it("returns null when a job has no placed visits", () => {
    expect(jobNextVisit(mkJob({ visits: [] }))).toBeNull();
    // an unplaced visit (no date/tech/start) does not count
    expect(jobNextVisit(mkJob({ visits: [mkVisit({ id: "1" })] }))).toBeNull();
  });

  it("prefers the earliest future placed visit over a past one", () => {
    const past = mkVisit({ id: "1", date: dPlus(-3), techId: "1", start: 9 });
    const soon = mkVisit({ id: "2", date: dPlus(2), techId: "1", start: 9 });
    const later = mkVisit({ id: "3", date: dPlus(5), techId: "1", start: 9 });
    const j = mkJob({ visits: [later, past, soon] });
    expect(jobNextVisit(j)?.id).toBe("2");
  });

  it("falls back to the latest placed visit when all are in the past", () => {
    const older = mkVisit({ id: "1", date: dPlus(-5), techId: "1", start: 9 });
    const newer = mkVisit({ id: "2", date: dPlus(-1), techId: "1", start: 9 });
    const j = mkJob({ visits: [older, newer] });
    expect(jobNextVisit(j)?.id).toBe("2");
  });

  it("breaks a same-day tie by start time (total comparator, C1)", () => {
    const afternoon = mkVisit({ id: "1", date: dPlus(2), techId: "1", start: 14 });
    const morning = mkVisit({ id: "2", date: dPlus(2), techId: "1", start: 8 });
    const j = mkJob({ visits: [afternoon, morning] });
    expect(jobNextVisit(j)?.id).toBe("2");
  });
});

describe("jobMode", () => {
  it("reads an estimate service as estimate", () => {
    expect(jobMode(mkJob({ svc: "estimate" }))).toBe("estimate");
  });
  it("reads a priced job as install", () => {
    expect(jobMode(mkJob({ lines: [{ d: "Water heater", q: 1, r: 1800 }] }))).toBe("install");
  });
  it("reads an unpriced job as service (price on site)", () => {
    expect(jobMode(mkJob({ lines: [] }))).toBe("service");
    expect(jobMode(mkJob({ lines: [{ d: "TBD", q: 1, r: 0 }] }))).toBe("service");
  });
});

describe("custName", () => {
  it("resolves the lead name by id", () => {
    const leads = [mkLead({ id: "7", name: "Lan Nguyen" })];
    expect(custName(mkJob({ leadId: "7" }), leads)).toBe("Lan Nguyen");
  });
  it("falls back to an em dash when no lead matches", () => {
    expect(custName(mkJob({ leadId: "99" }), [])).toBe("—");
  });
});

describe("jobsUnscheduled", () => {
  it("includes live jobs with no placed visit and excludes done/archived", () => {
    const unplaced = mkJob({ id: "1", visits: [mkVisit({ id: "1" })] });
    const placed = mkJob({ id: "2", visits: [mkVisit({ id: "2", date: dPlus(1), techId: "1", start: 9 })] });
    const done = mkJob({ id: "3", status: "done", visits: [] });
    const archived = mkJob({ id: "4", archived: true, visits: [] });
    const ids = jobsUnscheduled([unplaced, placed, done, archived]).map((j) => j.id);
    expect(ids).toEqual(["1"]);
  });
});

describe("dayLoad", () => {
  it("sums a crew's visit hours for one day only", () => {
    const jobs = [
      mkJob({ id: "1", visits: [mkVisit({ id: "1", techId: "5", date: dPlus(0), start: 8, dur: 3 })] }),
      mkJob({ id: "2", visits: [mkVisit({ id: "2", techId: "5", date: dPlus(0), start: 12, dur: 2 })] }),
      mkJob({ id: "3", visits: [mkVisit({ id: "3", techId: "5", date: dPlus(1), start: 8, dur: 4 })] }),
      mkJob({ id: "4", visits: [mkVisit({ id: "4", techId: "6", date: dPlus(0), start: 8, dur: 5 })] }),
    ];
    expect(dayLoad(jobs, "5", dPlus(0))).toBe(5);
  });

  it("ignores archived jobs", () => {
    const jobs = [mkJob({ id: "1", archived: true, visits: [mkVisit({ techId: "5", date: dPlus(0), start: 8, dur: 3 })] })];
    expect(dayLoad(jobs, "5", dPlus(0))).toBe(0);
  });
});

// Sanity: mkTech color threads through (used by board avatar rendering).
describe("test factory", () => {
  it("builds a tech with an override color", () => {
    expect(mkTech({ color: "#abc" }).color).toBe("#abc");
  });
});
