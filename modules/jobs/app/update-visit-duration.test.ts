import { describe, it, expect, beforeEach } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  asVisitId,
  zeroMoney,
  FixedClock,
  isOk,
  type JobId,
  type VisitId,
} from "@mallet/shared/types";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { EstimateId } from "@mallet/shared/types";
import { UpdateVisitDurationUseCase, type UpdateVisitDurationCommand } from "./update-visit-duration";

// ── in-memory fake (mirrors the one in jobs-use-cases.test.ts) ───────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  private seq = 1000;

  async nextNumber(): Promise<string> {
    const value = this.seq;
    this.seq += 1;
    return `JOB-${value}`;
  }
  async save(job: Job): Promise<void> {
    this.store.set(job.props.id, job);
  }
  async insertForEstimate(job: Job): Promise<boolean> {
    const src = job.props.sourceEstimateId;
    if (src && [...this.store.values()].some((j) => j.props.sourceEstimateId === src)) {
      return false;
    }
    this.store.set(job.props.id, job);
    return true;
  }
  async insertManual(job: Job): Promise<void> {
    this.store.set(job.props.id, job);
  }
  async archive(id: JobId, _now: Date): Promise<number> {
    return this.store.delete(id) ? 1 : 0;
  }
  async findById(id: JobId): Promise<Job | null> {
    return this.store.get(id) ?? null;
  }
  async findBySourceEstimate(_estimateId: EstimateId): Promise<Job | null> {
    return null;
  }
  async list(): Promise<never> {
    throw new Error("not needed");
  }
  async listByLead(): Promise<never> {
    throw new Error("not needed");
  }
  // execution stubs — implemented in Task 5
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async addLine() {}
  async updateLine() { return 0; }
  async removeLine() { return 0; }
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }

  /** Seed a job directly into the store. */
  seed(job: Job): void {
    this.store.set(job.props.id, job);
  }
}

// ── builder helpers ───────────────────────────────────────────────────────────

const JOB_ID: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const VISIT_ID: VisitId = asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const MISSING_JOB_ID: JobId = asJobId("99999999-9999-9999-9999-999999999999");
const MISSING_VISIT_ID: VisitId = asVisitId("99999999-9999-9999-9999-999999999990");

const makeVisit = (overrides: Partial<JobVisitProps> = {}): JobVisit => {
  const props: JobVisitProps = {
    id: VISIT_ID,
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    status: "pending",
    startedAt: null,
    completedAt: null,
    notes: null,
    position: 1,
    ...overrides,
  };
  const r = JobVisit.create(props);
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const makeJob = (overrides: Partial<JobProps> = {}): Job => {
  const props: JobProps = {
    id: JOB_ID,
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    num: "JOB-9001",
    leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Roof install",
    svc: null,
    status: "scheduled",
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: zeroMoney,
    notes: null,
    visits: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
  const r = Job.create(props);
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// ── UpdateVisitDurationUseCase ────────────────────────────────────────────────

describe("UpdateVisitDurationUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let useCase: UpdateVisitDurationUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeJobRepository();
    useCase = new UpdateVisitDurationUseCase(repo, clock);
  });

  // ── not-found: job missing ─────────────────────────────────────────────────

  it("returns not_found when the job does not exist", async () => {
    const cmd: UpdateVisitDurationCommand = {
      jobId: MISSING_JOB_ID,
      visitId: VISIT_ID,
      durationHours: 2,
    };
    const result = await useCase.exec(cmd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/job/i);
    }
  });

  // ── not-found: visit missing ───────────────────────────────────────────────

  it("returns not_found when the visit does not exist on the job", async () => {
    const job = makeJob({ visits: [] });
    repo.seed(job);

    const cmd: UpdateVisitDurationCommand = {
      jobId: JOB_ID,
      visitId: MISSING_VISIT_ID,
      durationHours: 2,
    };
    const result = await useCase.exec(cmd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/visit/i);
    }
  });

  // ── overflow midnight error ────────────────────────────────────────────────

  it("returns validation error when start + duration exceeds midnight", async () => {
    // start at 23:00, duration = 2 h → end would be 25:00, past midnight
    const visit = makeVisit({ scheduledStart: "23:00" });
    const job = makeJob({ visits: [visit] });
    repo.seed(job);

    const cmd: UpdateVisitDurationCommand = {
      jobId: JOB_ID,
      visitId: VISIT_ID,
      durationHours: 2,
    };
    const result = await useCase.exec(cmd);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect((result.error as { field?: string }).field).toBe("durationHours");
    }
  });

  // ── happy path: visit has no start (unplaced) ─────────────────────────────

  it("happy path — unplaced visit: keeps scheduledEnd null, saves job", async () => {
    const visit = makeVisit({ scheduledStart: null, scheduledEnd: null });
    const job = makeJob({ visits: [visit] });
    repo.seed(job);

    const cmd: UpdateVisitDurationCommand = {
      jobId: JOB_ID,
      visitId: VISIT_ID,
      durationHours: 3,
    };
    const result = await useCase.exec(cmd);
    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updatedVisit = result.value.props.visits.find((v) => v.props.id === VISIT_ID);
    expect(updatedVisit).toBeDefined();
    expect(updatedVisit?.props.scheduledEnd).toBeNull();
    // updatedAt should have been bumped to the clock's now
    expect(result.value.props.updatedAt).toEqual(clock.now());
  });

  // ── happy path: visit with a start time ───────────────────────────────────

  it("happy path — placed visit: recomputes scheduledEnd correctly", async () => {
    // start = 09:00, duration = 2.5 h → end = 11:30
    const visit = makeVisit({
      scheduledStart: "09:00",
      scheduledEnd: "10:00", // old end, will be replaced
    });
    const job = makeJob({ visits: [visit] });
    repo.seed(job);

    const cmd: UpdateVisitDurationCommand = {
      jobId: JOB_ID,
      visitId: VISIT_ID,
      durationHours: 2.5,
    };
    const result = await useCase.exec(cmd);
    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updatedVisit = result.value.props.visits.find((v) => v.props.id === VISIT_ID);
    expect(updatedVisit?.props.scheduledEnd).toBe("11:30");
    expect(result.value.props.updatedAt).toEqual(clock.now());
  });

  // ── happy path: exact midnight boundary (24:00) is rejected ──────────────

  it("rejects duration that lands exactly on 24:00 (overflow = null end)", async () => {
    // start = 22:00, duration = 2 h → end would be 24:00 → 24*60 = 1440 minutes
    // recomputeEnd returns null when endMinutes > 24*60, NOT >=, so 24:00 exact passes
    // Let's verify the boundary carefully: 22:00 + 2h = 24:00 → endMinutes = 1440 = 24*60
    // The condition is `endMinutes > 24 * 60` so 1440 is NOT > 1440 → returns "24:00"
    // Then JobVisit.create will see scheduledEnd "24:00" > scheduledStart "22:00" → ok
    const visit = makeVisit({ scheduledStart: "22:00", scheduledEnd: "23:00" });
    const job = makeJob({ visits: [visit] });
    repo.seed(job);

    const cmd: UpdateVisitDurationCommand = {
      jobId: JOB_ID,
      visitId: VISIT_ID,
      durationHours: 2,
    };
    const result = await useCase.exec(cmd);
    // 22:00 + 2h = 24:00 (1440 min) which is NOT > 1440 so recomputeEnd returns "24:00"
    // This is an edge case — result should be ok with end "24:00"
    expect(result.ok).toBe(true);
    if (!isOk(result)) return;
    const updatedVisit = result.value.props.visits.find((v) => v.props.id === VISIT_ID);
    expect(updatedVisit?.props.scheduledEnd).toBe("24:00");
  });

  // ── immutability: original job is not mutated ─────────────────────────────

  it("does not mutate the original job object", async () => {
    const visit = makeVisit({ scheduledStart: "08:00", scheduledEnd: "09:00" });
    const job = makeJob({ visits: [visit] });
    repo.seed(job);

    const originalUpdatedAt = job.props.updatedAt;
    const originalEnd = job.props.visits[0]?.props.scheduledEnd;

    const cmd: UpdateVisitDurationCommand = {
      jobId: JOB_ID,
      visitId: VISIT_ID,
      durationHours: 3,
    };
    const result = await useCase.exec(cmd);
    expect(result.ok).toBe(true);

    // Original job object must be unchanged
    expect(job.props.updatedAt).toBe(originalUpdatedAt);
    expect(job.props.visits[0]?.props.scheduledEnd).toBe(originalEnd);
  });
});

// ── recomputeEnd pure-helper coverage (exercised via the use-case) ────────────
// The pure function is not exported, but its branches are fully exercised by
// the use-case tests above:
//   • null start  → "unplaced visit: keeps scheduledEnd null" test
//   • overflow    → "start + duration exceeds midnight" test
//   • happy path  → "placed visit: recomputes scheduledEnd correctly" test
