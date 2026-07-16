import { describe, it, expect, beforeEach } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  zeroMoney,
  FixedClock,
  isOk,
  type JobId,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job, type JobProps } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import type { EstimateId } from "@mallet/shared/types";
import { RescheduleJobUseCase, type RescheduleJobCommand } from "./reschedule-job";

// ── helpers ───────────────────────────────────────────────────────────────────

const JOB_ID = asJobId("11111111-1111-1111-1111-111111111111");
const ORG_ID = asOrgId("22222222-2222-2222-2222-222222222222");
const ABSENT_JOB_ID = asJobId("99999999-9999-9999-9999-999999999999");

const jobProps = (overrides: Partial<JobProps> = {}): JobProps => ({
  id: JOB_ID,
  orgId: ORG_ID,
  num: "JOB-1000",
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

// ── FakeJobRepository ─────────────────────────────────────────────────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();

  seed(job: Job): void {
    this.store.set(job.props.id, job);
  }

  async nextNumber(): Promise<string> {
    return "JOB-0001";
  }
  async save(job: Job): Promise<void> {
    this.store.set(job.props.id, job);
  }
  async insertForEstimate(job: Job): Promise<boolean> {
    this.store.set(job.props.id, job);
    return true;
  }
  async insertManual(job: Job): Promise<void> {
    this.store.set(job.props.id, job);
  }
  async archiveByLead(): Promise<number> { return 0; }
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
    throw new Error("list not needed in reschedule-job tests");
  }
  async listByLead(): Promise<never> {
    throw new Error("listByLead not needed in reschedule-job tests");
  }
  // execution stubs — implemented in Task 5
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async listExecutionForJobs() { return new Map(); }
  async addLine() {}
  async updateLine() { return 0; }
  async removeLine() { return 0; }
  async replaceLines() {}
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
  async listRecentForCallbackScan() { return []; }
}

// ── RescheduleJobUseCase ──────────────────────────────────────────────────────

describe("RescheduleJobUseCase", () => {
  const START = new Date("2026-07-20T08:00:00Z");
  const END = new Date("2026-07-20T10:00:00Z");
  const NOW = new Date("2026-07-09T12:00:00Z");

  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;
  let useCase: RescheduleJobUseCase;

  const baseCmd = (): RescheduleJobCommand => ({
    jobId: JOB_ID,
    scheduledStart: START,
    scheduledEnd: END,
  });

  beforeEach(() => {
    clock = new FixedClock(NOW);
    repo = new FakeJobRepository();
    bus = new InMemoryEventBus();
    useCase = new RescheduleJobUseCase(repo, bus, clock);
  });

  // ── not-found: job missing ────────────────────────────────────────────────

  it("returns not_found when the job does not exist in the repository", async () => {
    // repo is empty — no job seeded
    const result = await useCase.exec({ ...baseCmd(), jobId: ABSENT_JOB_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/job/i);
    }
  });

  it("does not emit any event when the job is not found", async () => {
    await useCase.exec({ ...baseCmd(), jobId: ABSENT_JOB_ID });
    expect(bus.recorded).toHaveLength(0);
  });

  // ── domain schedule() failure ─────────────────────────────────────────────

  it("returns validation error when scheduledEnd is before scheduledStart", async () => {
    const job = makeJob();
    repo.seed(job);

    const result = await useCase.exec({
      jobId: JOB_ID,
      scheduledStart: END,   // end before start — deliberately swapped
      scheduledEnd: START,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  it("does not emit any event when domain schedule() fails", async () => {
    const job = makeJob();
    repo.seed(job);

    await useCase.exec({
      jobId: JOB_ID,
      scheduledStart: END,
      scheduledEnd: START,
    });

    expect(bus.recorded).toHaveLength(0);
  });

  it("returns validation error when rescheduling a completed job", async () => {
    // Build a completed job (status must be "complete")
    const completedJob = makeJob({ status: "complete", completedAt: new Date("2026-07-05T10:00:00Z") });
    repo.seed(completedJob);

    const result = await useCase.exec(baseCmd());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.message).toMatch(/completed|canceled/i);
    }
  });

  it("returns validation error when rescheduling a canceled job", async () => {
    const canceledJob = makeJob({
      status: "canceled",
      canceledAt: new Date("2026-07-05T10:00:00Z"),
      cancelReason: "customer withdrew",
    });
    repo.seed(canceledJob);

    const result = await useCase.exec(baseCmd());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("happy path: returns ok with the updated job carrying the new schedule", async () => {
    const job = makeJob();
    repo.seed(job);

    const result = await useCase.exec(baseCmd());

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.scheduledStart).toEqual(START);
    expect(result.value.props.scheduledEnd).toEqual(END);
  });

  it("happy path: persists the rescheduled job to the repository", async () => {
    const job = makeJob();
    repo.seed(job);

    const result = await useCase.exec(baseCmd());
    expect(result.ok).toBe(true);

    const saved = await repo.findById(JOB_ID);
    expect(saved).not.toBeNull();
    expect(saved?.props.scheduledStart).toEqual(START);
    expect(saved?.props.scheduledEnd).toEqual(END);
  });

  it("happy path: bumps updatedAt to clock.now() on the saved job", async () => {
    const job = makeJob();
    repo.seed(job);

    const result = await useCase.exec(baseCmd());
    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    expect(result.value.props.updatedAt).toEqual(NOW);
  });

  it("happy path: emits exactly one job.rescheduled event", async () => {
    const job = makeJob();
    repo.seed(job);

    await useCase.exec(baseCmd());

    expect(bus.recorded).toHaveLength(1);
    const event = bus.recorded[0];
    expect(event?.name).toBe("job.rescheduled");
  });

  it("happy path: emitted event carries correct orgId and jobId payload", async () => {
    const job = makeJob();
    repo.seed(job);

    await useCase.exec(baseCmd());

    const event = bus.recorded[0];
    expect(event?.orgId).toBe(ORG_ID);
    expect(event?.payload.jobId).toBe(JOB_ID);
  });

  it("happy path: emitted event occurredAt equals clock.now()", async () => {
    const job = makeJob();
    repo.seed(job);

    await useCase.exec(baseCmd());

    const event = bus.recorded[0];
    expect(event?.occurredAt).toEqual(NOW);
  });

  it("does not mutate the original job object", async () => {
    const job = makeJob();
    repo.seed(job);

    const originalUpdatedAt = job.props.updatedAt;
    const originalStart = job.props.scheduledStart;

    await useCase.exec(baseCmd());

    // Original job object must be unchanged
    expect(job.props.updatedAt).toBe(originalUpdatedAt);
    expect(job.props.scheduledStart).toBe(originalStart);
  });
});
