import { describe, it, expect } from "vitest";
import { dPlus } from "@/lib/prototype-sample";
import { mkJob, mkVisit } from "./test-factories";
import { jobTotal, todayVisit, jobDoneDate } from "./today-derive";

describe("jobTotal", () => {
  it("sums quantity × rate across lines", () => {
    expect(jobTotal(mkJob({ lines: [{ d: "a", q: 2, r: 100 }, { d: "b", q: 1, r: 50 }] }))).toBe(250);
  });
  it("defaults a missing quantity to 1", () => {
    expect(jobTotal(mkJob({ lines: [{ d: "a", q: undefined as unknown as number, r: 75 }] }))).toBe(75);
  });
});

describe("todayVisit", () => {
  it("returns today's placed visit or null", () => {
    expect(todayVisit(mkJob({ visits: [mkVisit({ date: dPlus(0), techId: "1", start: 9 })] }))).not.toBeNull();
    expect(todayVisit(mkJob({ visits: [mkVisit({ date: dPlus(1), techId: "1", start: 9 })] }))).toBeNull();
  });
});

describe("jobDoneDate", () => {
  it("returns the latest done visit date, ignoring non-done visits", () => {
    expect(jobDoneDate(mkJob({ visits: [] }))).toBeNull();
    expect(jobDoneDate(mkJob({ visits: [mkVisit({ date: dPlus(-1), status: "scheduled" })] }))).toBeNull();
    const j = mkJob({
      visits: [mkVisit({ id: "1", date: dPlus(-3), status: "done" }), mkVisit({ id: "2", date: dPlus(-1), status: "done" })],
    });
    expect(jobDoneDate(j)).toBe(dPlus(-1));
  });
});
