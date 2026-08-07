/**
 * lib/store/visit-placement.test.ts
 *
 * The placement rules, and above all `recalcJobPlacement` — the client twin of `needsSlot` /
 * `today` / `week` / `upcoming` in modules/jobs/infra/job-views.ts. The two must answer the same
 * question or work goes missing: the server decides which jobs are listed under "Needs a slot"
 * and this decides how the job reads once it is loaded.
 */
import { describe, it, expect } from "vitest";
import { isVisitPlaced, isVisitDatedUnassigned, recalcJobPlacement } from "./visit-placement";

const v = (over: Partial<{ date: string | null; techId: string | null; start: number | null; status: string }> = {}) => ({
  date: "2026-08-04",
  techId: "tech-1",
  start: 9,
  status: "scheduled",
  ...over,
});

describe("isVisitPlaced", () => {
  it("needs a day, a crew and a start", () => {
    expect(isVisitPlaced(v())).toBe(true);
    expect(isVisitPlaced(v({ date: null }))).toBe(false);
    expect(isVisitPlaced(v({ techId: null }))).toBe(false);
    expect(isVisitPlaced(v({ start: null }))).toBe(false);
  });

  it("treats midnight as a real start — hour 0 is not 'no time'", () => {
    expect(isVisitPlaced(v({ start: 0 }))).toBe(true);
  });
});

describe("isVisitDatedUnassigned", () => {
  it("is the half-planned shape: a day with nobody on it", () => {
    expect(isVisitDatedUnassigned(v({ techId: null }))).toBe(true);
    expect(isVisitDatedUnassigned(v())).toBe(false);
    expect(isVisitDatedUnassigned(v({ date: null, techId: null }))).toBe(false);
  });
});

describe("recalcJobPlacement", () => {
  it("no visits at all — nothing has been slotted", () => {
    expect(recalcJobPlacement([])).toBe("unscheduled");
  });

  it("only unplaced visits — still needs a slot", () => {
    expect(recalcJobPlacement([v({ date: null, techId: null, start: null })])).toBe("unscheduled");
  });

  it("a placed visit still to run — scheduled", () => {
    expect(recalcJobPlacement([v()])).toBe("scheduled");
  });

  it("every placed visit finished, and nothing else outstanding — done", () => {
    expect(recalcJobPlacement([v({ status: "done" })])).toBe("done");
  });

  it("one finished, one still to run — scheduled, on the strength of the one still to run", () => {
    expect(recalcJobPlacement([v({ status: "done" }), v({ start: 14 })])).toBe("scheduled");
  });

  /**
   * THE FOLLOW-UP CASE. First trip done, part on order, return visit booked from the field with
   * no date and nobody on it. Reading only PLACED visits, this said "done" — so the one job on
   * the screen that genuinely needs a date read as finished work.
   */
  it("a finished trip plus an unplaced follow-up needs a slot, not 'done'", () => {
    const visits = [v({ status: "done" }), v({ date: null, techId: null, start: null, status: "scheduled" })];
    expect(recalcJobPlacement(visits)).toBe("unscheduled");
  });

  it("a finished trip plus an unplaced visit that is ALSO finished is just done", () => {
    const visits = [v({ status: "done" }), v({ date: null, techId: null, start: null, status: "done" })];
    expect(recalcJobPlacement(visits)).toBe("done");
  });
});
