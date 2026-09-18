import { describe, it, expect } from "vitest";
import { visitLabor, rollUpLabor, type LaborVisit } from "./labor-rollup";

const at = (iso: string) => new Date(iso);

const visit = (over: Partial<LaborVisit> = {}): LaborVisit => ({
  jobId: "job-1",
  startedAt: at("2026-08-04T16:00:00Z"),
  completedAt: at("2026-08-04T18:30:00Z"),
  durationMinutes: 120,
  complete: true,
  costRateCents: 3200, // $32/h burdened — Housecall Pro's own worked example for a $25/h W-2
  ...over,
});

describe("visitLabor", () => {
  it("measures the real span when both taps landed", () => {
    expect(visitLabor(visit())).toEqual({ hours: 2.5, source: "measured", costCents: 8000 });
  });

  it("prefers the measured span over the booked length — 2.5h happened, 2h was the plan", () => {
    const result = visitLabor(visit({ durationMinutes: 120 }));
    expect(result?.hours).toBe(2.5);
    expect(result?.source).toBe("measured");
  });

  it("falls back to the booked length when nobody tapped, and SAYS it was scheduled", () => {
    const result = visitLabor(visit({ startedAt: null, completedAt: null }));
    expect(result).toEqual({ hours: 2, source: "scheduled", costCents: 6400 });
  });

  /**
   * A visit that is arrived-but-not-done has no final figure. Substituting the booked length
   * would put a FORECAST in a costing report, and the number would move every time the page was
   * opened.
   */
  it("contributes nothing while the visit is still running", () => {
    expect(visitLabor(visit({ completedAt: null, complete: false }))).toBeNull();
  });

  it("contributes nothing when it was never measured and never booked a length", () => {
    expect(visitLabor(visit({ startedAt: null, completedAt: null, durationMinutes: null }))).toBeNull();
  });

  /**
   * Clocks move backwards — a device with a bad time, an office correction that crossed the
   * stamps. One such row would subtract from a job's cost and report margin nobody earned.
   */
  it("refuses a backwards span rather than costing it negative", () => {
    const crossed = visit({ startedAt: at("2026-08-04T18:30:00Z"), completedAt: at("2026-08-04T16:00:00Z") });
    // Falls through to the booked length, because the visit did finish — never to a negative.
    expect(visitLabor(crossed)?.hours).toBe(2);
    expect(visitLabor({ ...crossed, durationMinutes: null })).toBeNull();
  });

  it("reports hours with NO money when the shop never set a cost rate — never hours at $0", () => {
    const result = visitLabor(visit({ costRateCents: null }));
    expect(result?.hours).toBe(2.5);
    expect(result?.costCents).toBeNull();
  });

  it("costs a zero rate as zero — an unpaid owner-operator is a real answer, null is not", () => {
    expect(visitLabor(visit({ costRateCents: 0 }))?.costCents).toBe(0);
  });
});

describe("rollUpLabor", () => {
  it("sums a job's visits and counts only the ones that contributed", () => {
    const [job] = rollUpLabor([
      visit({ jobId: "j1" }),
      visit({ jobId: "j1", startedAt: at("2026-08-06T15:00:00Z"), completedAt: at("2026-08-06T16:00:00Z") }),
      // Still on site — contributes nothing, and is not counted as a visit either.
      visit({ jobId: "j1", completedAt: null, complete: false }),
    ]);

    expect(job).toMatchObject({ jobId: "j1", visits: 2, hours: 3.5, costCents: 11200, source: "measured" });
  });

  it("says 'mixed' when one visit was measured and another only scheduled", () => {
    const [job] = rollUpLabor([
      visit({ jobId: "j1" }),
      visit({ jobId: "j1", startedAt: null, completedAt: null }),
    ]);
    expect(job?.source).toBe("mixed");
  });

  it("keeps the half it can price and flags it, for a shop mid-way through filling rates in", () => {
    const [job] = rollUpLabor([
      visit({ jobId: "j1" }),
      visit({ jobId: "j1", costRateCents: null }),
    ]);
    expect(job?.costCents).toBe(8000);
    expect(job?.costIsPartial).toBe(true);
  });

  it("reports no cost at all when nobody on the job has a rate", () => {
    const [job] = rollUpLabor([visit({ jobId: "j1", costRateCents: null })]);
    expect(job?.costCents).toBeNull();
    expect(job?.costIsPartial).toBe(false);
  });

  it("omits a job whose visits all contribute nothing, rather than showing it at zero", () => {
    expect(rollUpLabor([visit({ jobId: "j1", completedAt: null, complete: false })])).toEqual([]);
  });

  it("separates jobs", () => {
    const rows = rollUpLabor([visit({ jobId: "j1" }), visit({ jobId: "j2" })]);
    expect(rows.map((r) => r.jobId).sort()).toEqual(["j1", "j2"]);
  });
});
