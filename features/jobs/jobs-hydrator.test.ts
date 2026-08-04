/**
 * features/jobs/jobs-hydrator.test.ts
 * Unit tests for the pure time-conversion helpers and visit status mapping
 * exported from jobs-hydrator.tsx.
 */

import { describe, it, expect } from "vitest";
import { hhmmToHour, hoursBetween, toStoreJob } from "./jobs-hydrator";

describe("hhmmToHour", () => {
  it("converts whole hours", () => {
    expect(hhmmToHour("09:00")).toBe(9);
    expect(hhmmToHour("14:00")).toBe(14);
    expect(hhmmToHour("00:00")).toBe(0);
  });

  it("converts half hours correctly", () => {
    expect(hhmmToHour("09:30")).toBe(9.5);
    expect(hhmmToHour("07:15")).toBe(7.25);
    expect(hhmmToHour("16:45")).toBeCloseTo(16.75);
  });

  it("returns 0 for null, undefined, and empty string", () => {
    expect(hhmmToHour(null)).toBe(0);
    expect(hhmmToHour(undefined)).toBe(0);
    expect(hhmmToHour("")).toBe(0);
  });

  it("returns 0 for malformed strings", () => {
    expect(hhmmToHour("bad")).toBe(0);
    expect(hhmmToHour("9")).toBe(0);
  });
});

describe("hoursBetween", () => {
  it("computes simple durations", () => {
    expect(hoursBetween("08:00", "10:00")).toBe(2);
    expect(hoursBetween("09:00", "11:30")).toBe(2.5);
  });

  it("uses defaultDur when both values are absent", () => {
    expect(hoursBetween(null, null)).toBe(2);
    expect(hoursBetween(null, null, 4)).toBe(4);
  });

  it("uses defaultDur when end is before or equal to start", () => {
    expect(hoursBetween("10:00", "09:00")).toBe(2);
    expect(hoursBetween("10:00", "10:00")).toBe(2);
  });

  it("uses defaultDur when only one value is missing", () => {
    // start present but no end → diff cannot be computed
    expect(hoursBetween("08:00", null)).toBe(2);
  });

  it("respects a custom defaultDur", () => {
    expect(hoursBetween(null, null, 3)).toBe(3);
    expect(hoursBetween("10:00", "09:00", 1)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// toStoreJob — terminal status wins over visit-placement recalc
// (money-on-the-floor fix, mirrored from lib/store/dto-mapper.test.ts: this
// hydrator has its own copy of the same recalc — it backs v1.jobs.list, which
// runs on every office page load/refetch, including Money's.)
// ---------------------------------------------------------------------------

const baseSummaryDto = {
  id: "job-1",
  leadId: "lead-1",
  sourceEstimateId: null,
  svc: "service",
  kind: null,
  title: "Job",
  addr: "",
  phone: "",
  status: "scheduled" as const,
  notes: "",
  completion: undefined,
  invRequested: false,
  checklist: null,
  requiredCerts: null,
  visits: [] as unknown[],
};

const summaryVisit = {
  id: "vis-1",
  assigneeUserId: "tech-1",
  scheduledDate: "2026-07-15",
  scheduledStart: "09:00",
  scheduledEnd: "11:00",
  durationMinutes: null,
  status: "pending" as const,
  enrouteAt: null as string | null,
  startedAt: null,
  completedAt: null,
  notes: null,
  position: 0,
};

describe("toStoreJob terminal status wins over visit-placement recalc", () => {
  it("job 'complete' + one complete but UNPLACED visit → store 'done' (the regression)", () => {
    const unplacedCompleteVisit = {
      ...summaryVisit,
      status: "complete" as const,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
    };
    const job = toStoreJob({
      ...baseSummaryDto,
      status: "complete",
      visits: [unplacedCompleteVisit],
    } as never);
    expect(job.status).toBe("done");
  });

  it("job 'complete' + one PLACED complete visit → store 'done' (unchanged)", () => {
    const placedCompleteVisit = { ...summaryVisit, status: "complete" as const };
    const job = toStoreJob({
      ...baseSummaryDto,
      status: "complete",
      visits: [placedCompleteVisit],
    } as never);
    expect(job.status).toBe("done");
  });

  it("job 'scheduled' + an unplaced visit → store 'unscheduled' (unchanged)", () => {
    const unplacedVisit = { ...summaryVisit, scheduledDate: null, scheduledStart: null, scheduledEnd: null };
    const job = toStoreJob({
      ...baseSummaryDto,
      status: "scheduled",
      visits: [unplacedVisit],
    } as never);
    expect(job.status).toBe("unscheduled");
  });

  it("job 'canceled' → store 'done' (terminal, zero visits — unchanged)", () => {
    const job = toStoreJob({ ...baseSummaryDto, status: "canceled", visits: [] } as never);
    expect(job.status).toBe("done");
  });
});
