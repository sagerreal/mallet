import { describe, it, expect } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  asUserId,
  asVisitId,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "./job";

// ── helpers ──────────────────────────────────────────────────────────────────

const now = new Date("2026-07-08T10:00:00Z");

const visitProps = (overrides: Partial<JobVisitProps> = {}): JobVisitProps => ({
  id: asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
  assigneeUserId: null,
  scheduledDate: null,
  scheduledStart: null,
  scheduledEnd: null,
  durationMinutes: null,
  status: "pending",
  startedAt: null,
  completedAt: null,
  notes: null,
  position: 1,
  ...overrides,
});

const makeVisit = (overrides: Partial<JobVisitProps> = {}): JobVisit => {
  const r = JobVisit.create(visitProps(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const jobProps = (overrides: Partial<JobProps> = {}): JobProps => ({
  id: asJobId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  num: "JOB-9001",
  leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
  sourceEstimateId: null,
  assigneeUserId: null,
  title: "Roof install",
  svc: null,
  kind: "work",
  status: "scheduled",
  scheduledStart: null,
  scheduledEnd: null,
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  cancelReason: null,
  total: zeroMoney,
  notes: null,
  scope: null,
  callbackOf: null,
  callbackReason: null,
  checklist: null,
  visits: [],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeJob = (overrides: Partial<JobProps> = {}): Job => {
  const r = Job.create(jobProps(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// ── JobVisit.create ──────────────────────────────────────────────────────────

describe("JobVisit.create", () => {
  it("rejects an unknown status", () => {
    const r = JobVisit.create(visitProps({ status: "flying" as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("status");
  });

  it("accepts all valid statuses", () => {
    for (const status of ["pending", "in_progress", "complete", "canceled"] as const) {
      expect(JobVisit.create(visitProps({ status })).ok).toBe(true);
    }
  });

  it("rejects scheduledEnd <= scheduledStart", () => {
    const r = JobVisit.create(
      visitProps({ scheduledStart: "10:00", scheduledEnd: "09:00" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("scheduledEnd");
  });

  it("rejects scheduledEnd equal to scheduledStart", () => {
    const r = JobVisit.create(
      visitProps({ scheduledStart: "08:00", scheduledEnd: "08:00" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("scheduledEnd");
  });

  it("accepts scheduledEnd strictly after scheduledStart", () => {
    const r = JobVisit.create(
      visitProps({ scheduledStart: "08:00", scheduledEnd: "10:00" }),
    );
    expect(r.ok).toBe(true);
  });

  it("accepts null start/end (unplaced visit)", () => {
    expect(JobVisit.create(visitProps({ scheduledStart: null, scheduledEnd: null })).ok).toBe(true);
  });

  it("accepts a valid durationMinutes on an unplaced visit", () => {
    expect(JobVisit.create(visitProps({ durationMinutes: 90 })).ok).toBe(true);
  });

  it("accepts null durationMinutes (legacy row)", () => {
    expect(JobVisit.create(visitProps({ durationMinutes: null })).ok).toBe(true);
  });

  it("accepts the 1440-minute (24h) ceiling", () => {
    expect(JobVisit.create(visitProps({ durationMinutes: 1440 })).ok).toBe(true);
  });

  it("rejects zero / negative / fractional / over-24h durationMinutes", () => {
    for (const durationMinutes of [0, -15, 90.5, 1441]) {
      const r = JobVisit.create(visitProps({ durationMinutes }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.field).toBe("durationMinutes");
    }
  });
});

// ── JobVisit.isPlaced ────────────────────────────────────────────────────────

describe("JobVisit.isPlaced()", () => {
  it("returns false when all scheduling fields are null", () => {
    expect(makeVisit().isPlaced()).toBe(false);
  });

  it("returns false when only date is set (missing assignee + start)", () => {
    expect(makeVisit({ scheduledDate: "2026-07-10" }).isPlaced()).toBe(false);
  });

  it("returns false when only assignee is set", () => {
    const userId = asUserId("44444444-4444-4444-4444-444444444444");
    expect(makeVisit({ assigneeUserId: userId }).isPlaced()).toBe(false);
  });

  it("returns false when date + assignee set but start missing", () => {
    const userId = asUserId("44444444-4444-4444-4444-444444444444");
    expect(
      makeVisit({ scheduledDate: "2026-07-10", assigneeUserId: userId }).isPlaced(),
    ).toBe(false);
  });

  it("returns true only when date + assignee + start are all set", () => {
    const userId = asUserId("44444444-4444-4444-4444-444444444444");
    expect(
      makeVisit({
        assigneeUserId: userId,
        scheduledDate: "2026-07-10",
        scheduledStart: "09:00",
      }).isPlaced(),
    ).toBe(true);
  });
});

// ── Job.withVisits ───────────────────────────────────────────────────────────

describe("Job.withVisits()", () => {
  it("adds a visit and returns a new Job with updatedAt bumped", () => {
    const job = makeJob();
    const visit = makeVisit();
    const r = job.withVisits([visit], now);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits).toHaveLength(1);
    expect(r.value.props.visits[0]).toBe(visit);
    expect(r.value.props.updatedAt).toBe(now);
  });

  it("is immutable: the original Job is unchanged", () => {
    const job = makeJob();
    const visit = makeVisit();
    const r = job.withVisits([visit], now);
    expect(isOk(r)).toBe(true);
    // Original job still has no visits.
    expect(job.props.visits).toHaveLength(0);
    if (!isOk(r)) return;
    expect(r.value).not.toBe(job);
  });

  it("removing a visit produces a new Job leaving original untouched", () => {
    const visitA = makeVisit({ id: asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), position: 1 });
    const visitB = makeVisit({ id: asVisitId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), position: 2 });
    const job = makeJob({ visits: [visitA, visitB] });

    const r = job.withVisits([visitA], now); // remove visitB
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits).toHaveLength(1);
    expect(r.value.props.visits[0]).toBe(visitA);
    // Original still has both.
    expect(job.props.visits).toHaveLength(2);
  });

  it("rejects withVisits on a completed (terminal) job", () => {
    const startedR = makeJob().start(now);
    if (!isOk(startedR)) throw new Error("start failed");
    const completedR = startedR.value.complete(now);
    if (!isOk(completedR)) throw new Error("complete failed");
    const visit = makeVisit();
    const r = completedR.value.withVisits([visit], now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("status");
  });

  it("rejects withVisits on a canceled (terminal) job", () => {
    const canceledR = makeJob().cancel("customer no-show", now);
    if (!isOk(canceledR)) throw new Error("cancel failed");
    const visit = makeVisit();
    const r = canceledR.value.withVisits([visit], now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("status");
  });

  it("allows withVisits on a scheduled job", () => {
    const job = makeJob({ status: "scheduled" });
    expect(job.withVisits([makeVisit()], now).ok).toBe(true);
  });

  it("allows withVisits on an in_progress job", () => {
    const startedR = makeJob().start(now);
    if (!isOk(startedR)) throw new Error("start failed");
    expect(startedR.value.withVisits([makeVisit()], now).ok).toBe(true);
  });
});

// ── Job.isAssignedTo (field-surface authorization predicate) ─────────────────

describe("Job.isAssignedTo", () => {
  const tech = asUserId("44444444-4444-4444-4444-444444444444");
  const otherTech = asUserId("55555555-5555-5555-5555-555555555555");

  it("true for the job-level assignee", () => {
    expect(makeJob({ assigneeUserId: tech }).isAssignedTo(tech)).toBe(true);
  });

  it("true for the assignee of an active (non-canceled) visit", () => {
    for (const status of ["pending", "in_progress", "complete"] as const) {
      const job = makeJob({ visits: [makeVisit({ assigneeUserId: tech, status })] });
      expect(job.isAssignedTo(tech)).toBe(true);
    }
  });

  it("false when the user's only visit is canceled", () => {
    const job = makeJob({ visits: [makeVisit({ assigneeUserId: tech, status: "canceled" })] });
    expect(job.isAssignedTo(tech)).toBe(false);
  });

  it("false for a user with no claim on the job", () => {
    const job = makeJob({
      assigneeUserId: tech,
      visits: [makeVisit({ assigneeUserId: tech })],
    });
    expect(job.isAssignedTo(otherTech)).toBe(false);
  });

  it("false when neither job nor visits carry an assignee", () => {
    const job = makeJob({ visits: [makeVisit({ assigneeUserId: null })] });
    expect(job.isAssignedTo(tech)).toBe(false);
  });
});

// ── JobVisit.create — lat/lng geocoded point ─────────────────────────────────

describe("JobVisit.create — lat/lng", () => {
  it("accepts a valid geocoded point and exposes it on props", () => {
    const r = JobVisit.create(visitProps({ lat: 37.6, lng: -122.4 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.props.lat).toBe(37.6);
    expect(r.value.props.lng).toBe(-122.4);
  });

  it("defaults both lat and lng to null when omitted", () => {
    const r = JobVisit.create(visitProps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.props.lat).toBeNull();
    expect(r.value.props.lng).toBeNull();
  });

  it("defaults both lat and lng to null when explicitly undefined", () => {
    const r = JobVisit.create(visitProps({ lat: undefined, lng: undefined }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.props.lat).toBeNull();
    expect(r.value.props.lng).toBeNull();
  });

  it("rejects lat without lng (both-or-neither rule)", () => {
    const r = JobVisit.create(visitProps({ lat: 37.6, lng: undefined }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.field).toBe("lat");
      expect(r.error.message).toMatch(/must be set together/);
    }
  });

  it("rejects lng without lat (both-or-neither rule)", () => {
    const r = JobVisit.create(visitProps({ lat: undefined, lng: -122.4 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("lat");
  });

  it("rejects lat null with lng non-null (both-or-neither rule)", () => {
    const r = JobVisit.create(visitProps({ lat: null, lng: -122.4 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("lat");
  });

  it("rejects lat above 90 (out of range)", () => {
    const r = JobVisit.create(visitProps({ lat: 91, lng: -122.4 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("lat");
  });

  it("rejects lat below -90 (out of range)", () => {
    const r = JobVisit.create(visitProps({ lat: -91, lng: -122.4 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("lat");
  });

  it("accepts lat at the extremes (-90 and 90)", () => {
    expect(JobVisit.create(visitProps({ lat: 90, lng: 0 })).ok).toBe(true);
    expect(JobVisit.create(visitProps({ lat: -90, lng: 0 })).ok).toBe(true);
  });

  it("rejects lng above 180 (out of range)", () => {
    const r = JobVisit.create(visitProps({ lat: 37.6, lng: 181 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("lng");
  });

  it("rejects lng below -180 (out of range)", () => {
    const r = JobVisit.create(visitProps({ lat: 37.6, lng: -181 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("lng");
  });

  it("accepts lng at the extremes (-180 and 180)", () => {
    expect(JobVisit.create(visitProps({ lat: 0, lng: 180 })).ok).toBe(true);
    expect(JobVisit.create(visitProps({ lat: 0, lng: -180 })).ok).toBe(true);
  });
});
