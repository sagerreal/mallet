/**
 * components/modals/tech-job-modal/helpers.test.ts
 *
 * isUnpricedEstimate — THE predicate the estimate-visit billing gates hang on
 * (DoneBlock vs ScopeHandoffBlock, the MoneyPointer, and — via its SQL twin in
 * modules/jobs/infra/job-views.ts — the "Done, not billed" band). A scoping
 * visit must never read as billable; a quote signed on site (priced lines) must.
 */
import { describe, it, expect } from "vitest";
import type { Job } from "@/lib/store/types";
import { isUnpricedEstimate } from "./helpers";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Fix water heater",
    status: "done",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  } as Job;
}

describe("isUnpricedEstimate", () => {
  it("true for an estimate with no lines — a pure scoping visit", () => {
    expect(isUnpricedEstimate(makeJob({ svc: "estimate", lines: [] }))).toBe(true);
  });

  it("true for an estimate whose lines carry no money (zero-rate placeholders)", () => {
    expect(
      isUnpricedEstimate(makeJob({ svc: "estimate", lines: [{ d: "Walkthrough", q: 1, r: 0 }] })),
    ).toBe(true);
  });

  it("false for an estimate with priced lines — signed on site stays billable", () => {
    expect(
      isUnpricedEstimate(makeJob({ svc: "estimate", lines: [{ d: "Repaint hall", q: 1, r: 400 }] })),
    ).toBe(false);
  });

  it("false for a non-estimate job, priced or not — unpriced SERVICE work still bills on site", () => {
    expect(isUnpricedEstimate(makeJob({ svc: "service", lines: [] }))).toBe(false);
    expect(
      isUnpricedEstimate(makeJob({ svc: "service", lines: [{ d: "Diagnostic", q: 1, r: 285 }] })),
    ).toBe(false);
  });
});
