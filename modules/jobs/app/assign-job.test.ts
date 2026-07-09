import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asUserId,
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
import type { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { ScheduleJobUseCase } from "./schedule-job";
import { CompleteJobUseCase } from "./complete-job";
import { StartJobUseCase } from "./start-job";
import { CancelJobUseCase } from "./cancel-job";
import { AssignJobUseCase } from "./assign-job";

// ── constants ────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const MISSING_JOB: JobId = asJobId("99999999-9999-9999-9999-999999999999");
const USER_A = asUserId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

// ── FakeJobRepository ────────────────────────────────────────────────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  private seq = 1000;

  async nextNumber(): Promise<string> {
    const n = this.seq;
    this.seq += 1;
    return `JOB-${n}`;
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

  async findById(id: JobId): Promise<Job | null> {
    return this.store.get(id) ?? null;
  }

  async findBySourceEstimate(estimateId: EstimateId): Promise<Job | null> {
    return [...this.store.values()].find((j) => j.props.sourceEstimateId === estimateId) ?? null;
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

// ── AssignJobUseCase ─────────────────────────────────────────────────────────

describe("AssignJobUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;
  let useCase: AssignJobUseCase;

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
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeJobRepository();
    bus = new InMemoryEventBus();
    useCase = new AssignJobUseCase(repo, bus, clock);
  });

  // ── not-found path ───────────────────────────────────────────────────────

  it("returns not_found when the job does not exist", async () => {
    const result = await useCase.exec({ jobId: MISSING_JOB, assigneeUserId: USER_A });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("does not emit an event when the job is not found", async () => {
    await useCase.exec({ jobId: MISSING_JOB, assigneeUserId: USER_A });
    expect(bus.recorded.filter((e) => e.name === "job.assigned")).toHaveLength(0);
  });

  // ── isOk failure path (assignTo returns err for terminal jobs) ───────────

  it("returns an error when attempting to assign a completed job", async () => {
    const jobId = await seedScheduledJob();
    await new StartJobUseCase(repo, bus, clock).exec({ jobId });
    await new CompleteJobUseCase(repo, bus, clock).exec({ jobId });

    const result = await useCase.exec({ jobId, assigneeUserId: USER_A });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  it("returns an error when attempting to assign a canceled job", async () => {
    const jobId = await seedScheduledJob();
    await new CancelJobUseCase(repo, bus, clock).exec({ jobId, reason: "no longer needed" });

    const result = await useCase.exec({ jobId, assigneeUserId: USER_A });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  it("does not emit an event when assignTo fails (terminal job)", async () => {
    const jobId = await seedScheduledJob();
    await new StartJobUseCase(repo, bus, clock).exec({ jobId });
    await new CompleteJobUseCase(repo, bus, clock).exec({ jobId });
    // drain bus events emitted during setup
    const preCount = bus.recorded.filter((e) => e.name === "job.assigned").length;

    await useCase.exec({ jobId, assigneeUserId: USER_A });

    expect(bus.recorded.filter((e) => e.name === "job.assigned")).toHaveLength(preCount);
  });

  // ── assign (non-null assigneeUserId) ────────────────────────────────────

  it("sets the assignee on a scheduled job and returns the updated job", async () => {
    const jobId = await seedScheduledJob();
    const result = await useCase.exec({ jobId, assigneeUserId: USER_A });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.assigneeUserId).toBe(USER_A);
    }
  });

  it("emits job.assigned with the correct assigneeUserId when assigning a user", async () => {
    const jobId = await seedScheduledJob();
    await useCase.exec({ jobId, assigneeUserId: USER_A });

    const events = bus.recorded.filter((e) => e.name === "job.assigned");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ jobId, assigneeUserId: USER_A });
  });

  it("emits job.assigned with occurredAt equal to clock.now()", async () => {
    const jobId = await seedScheduledJob();
    const now = clock.now();
    await useCase.exec({ jobId, assigneeUserId: USER_A });

    const events = bus.recorded.filter((e) => e.name === "job.assigned");
    expect(events[0]?.occurredAt).toEqual(now);
  });

  // ── unassign (null assigneeUserId) ────────────────────────────────────────

  it("clears the assignee when assigneeUserId is null", async () => {
    const jobId = await seedScheduledJob();
    await useCase.exec({ jobId, assigneeUserId: USER_A });

    const result = await useCase.exec({ jobId, assigneeUserId: null });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.assigneeUserId).toBeNull();
    }
  });

  it("emits job.assigned with null assigneeUserId when unassigning", async () => {
    const jobId = await seedScheduledJob();
    await useCase.exec({ jobId, assigneeUserId: USER_A });

    await useCase.exec({ jobId, assigneeUserId: null });

    const events = bus.recorded.filter((e) => e.name === "job.assigned");
    // Second event is the unassign
    expect(events).toHaveLength(2);
    expect(events[1]?.payload).toMatchObject({ jobId, assigneeUserId: null });
  });

  it("emits job.assigned with orgId from the job when unassigning", async () => {
    const jobId = await seedScheduledJob();
    await useCase.exec({ jobId, assigneeUserId: USER_A });

    await useCase.exec({ jobId, assigneeUserId: null });

    const events = bus.recorded.filter((e) => e.name === "job.assigned");
    expect(events[1]?.orgId).toBe(ORG);
  });

  // ── persistence ──────────────────────────────────────────────────────────

  it("persists the updated assignee so a subsequent findById reflects the change", async () => {
    const jobId = await seedScheduledJob();
    await useCase.exec({ jobId, assigneeUserId: USER_A });

    const saved = await repo.findById(jobId);
    expect(saved?.props.assigneeUserId).toBe(USER_A);
  });

  it("persists null assigneeUserId after unassign so a subsequent findById reflects the change", async () => {
    const jobId = await seedScheduledJob();
    await useCase.exec({ jobId, assigneeUserId: USER_A });
    await useCase.exec({ jobId, assigneeUserId: null });

    const saved = await repo.findById(jobId);
    expect(saved?.props.assigneeUserId).toBeNull();
  });
});
