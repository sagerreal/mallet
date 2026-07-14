import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  FixedClock,
  isOk,
  type OrgId,
  type LeadId,
  type JobId,
  type EstimateId,
  type CursorPage,
  type Paginated,
  buildPage,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { ScheduleJobUseCase } from "./schedule-job";
import { StartJobUseCase } from "./start-job";

// ── constants ────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const MISSING_JOB: JobId = asJobId("99999999-9999-9999-9999-999999999999");

// ── FakeJobRepository ────────────────────────────────────────────────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  private seq = 1000;
  saveCallCount = 0;

  async nextNumber(): Promise<string> {
    const n = this.seq;
    this.seq += 1;
    return `JOB-${n}`;
  }

  async save(job: Job): Promise<void> {
    this.saveCallCount += 1;
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

  async list(page: CursorPage, _filter?: unknown): Promise<Paginated<Job>> {
    const rows = [...this.store.values()];
    return buildPage(rows.slice(0, page.limit + 1), page, (j) => ({
      createdAt: j.props.createdAt,
      id: j.props.id,
    }));
  }

  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Job>> {
    return this.list(page);
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
}

// ── helpers ──────────────────────────────────────────────────────────────────

const seqIds = () => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

// ── StartJobUseCase ───────────────────────────────────────────────────────────

describe("StartJobUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;
  let useCase: StartJobUseCase;

  const seedScheduledJob = async (): Promise<JobId> => {
    const r = await new ScheduleJobUseCase(repo, bus, clock, seqIds()).exec({
      orgId: ORG,
      leadId: LEAD,
      title: "Test job",
      scheduledStart: null,
      scheduledEnd: null,
      assigneeUserId: null,
    });
    if (!isOk(r)) throw new Error("schedule failed");
    return r.value.props.id;
  };

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T10:00:00Z"));
    repo = new FakeJobRepository();
    bus = new InMemoryEventBus();
    useCase = new StartJobUseCase(repo, bus, clock);
  });

  // ── not_found ────────────────────────────────────────────────────────────

  it("returns not_found when the job does not exist", async () => {
    const result = await useCase.exec({ jobId: MISSING_JOB });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("transitions a scheduled job to in_progress and emits job.started", async () => {
    const id = await seedScheduledJob();
    const result = await useCase.exec({ jobId: id });

    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.status).toBe("in_progress");
      expect(result.value.props.startedAt).toEqual(clock.now());
    }
    expect(bus.recorded.some((e) => e.name === "job.started")).toBe(true);
  });

  it("persists the updated job so a subsequent findById reflects in_progress", async () => {
    const id = await seedScheduledJob();
    await useCase.exec({ jobId: id });

    const saved = await repo.findById(id);
    expect(saved?.props.status).toBe("in_progress");
    expect(saved?.props.startedAt).toEqual(clock.now());
  });

  it("emits job.started with the correct orgId, jobId, and leadId", async () => {
    const id = await seedScheduledJob();
    await useCase.exec({ jobId: id });

    const event = bus.recorded.find((e) => e.name === "job.started");
    expect(event).toBeDefined();
    if (event) {
      expect(event.orgId).toBe(ORG);
      expect((event.payload as { jobId: JobId; leadId: LeadId }).jobId).toBe(id);
      expect((event.payload as { jobId: JobId; leadId: LeadId }).leadId).toBe(LEAD);
    }
  });

  // ── idempotent no-op branch (the uncovered branch) ───────────────────────

  it("idempotent: re-starting an already in_progress job returns ok with no persist and no new event", async () => {
    const id = await seedScheduledJob();
    // First call: transitions scheduled → in_progress
    const first = await useCase.exec({ jobId: id });
    expect(isOk(first)).toBe(true);

    const saveCountAfterFirst = repo.saveCallCount;
    const eventCountAfterFirst = bus.recorded.filter((e) => e.name === "job.started").length;

    // Second call: job is already in_progress — must be a no-op
    const second = await useCase.exec({ jobId: id });

    expect(second.ok).toBe(true);
    if (isOk(second)) {
      expect(second.value.props.status).toBe("in_progress");
    }
    // No additional save
    expect(repo.saveCallCount).toBe(saveCountAfterFirst);
    // No duplicate event
    expect(bus.recorded.filter((e) => e.name === "job.started")).toHaveLength(eventCountAfterFirst);
  });

  it("idempotent: second start returns the same job instance (same id and startedAt)", async () => {
    const id = await seedScheduledJob();
    const first = await useCase.exec({ jobId: id });
    if (!isOk(first)) throw new Error("first start failed");
    const startedAt = first.value.props.startedAt;

    // Advance the clock so we can confirm startedAt was NOT updated on the no-op call
    clock.advance(60_000);

    const second = await useCase.exec({ jobId: id });
    expect(isOk(second)).toBe(true);
    if (isOk(second)) {
      expect(second.value.props.id).toBe(id);
      // startedAt must remain from the original first call, not the advanced clock
      expect(second.value.props.startedAt).toEqual(startedAt);
    }
  });

  // ── invalid transition ────────────────────────────────────────────────────

  it("returns a validation error when attempting to start a completed job", async () => {
    const id = await seedScheduledJob();
    // Start then complete via direct domain manipulation so we can test start-on-complete
    const startResult = await useCase.exec({ jobId: id });
    if (!isOk(startResult)) throw new Error("start failed");
    const completed = startResult.value.complete(clock.now());
    if (!isOk(completed)) throw new Error("complete failed");
    await repo.save(completed.value);

    const result = await useCase.exec({ jobId: id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  it("returns a validation error when attempting to start a canceled job", async () => {
    const id = await seedScheduledJob();
    const cancelResult = (await repo.findById(id))?.cancel("no longer needed", clock.now());
    if (!cancelResult || !isOk(cancelResult)) throw new Error("cancel failed");
    await repo.save(cancelResult.value);

    const result = await useCase.exec({ jobId: id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });
});
