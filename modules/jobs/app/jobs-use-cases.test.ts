import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asJobId,
  asUserId,
  FixedClock,
  toPage,
  buildPage,
  decodeCursor,
  isOk,
  err,
  validation,
  type OrgId,
  type LeadId,
  type EstimateId,
  type JobId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { JobVisit, type Job } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";
import type { EstimateReader, EstimateSummary } from "../domain/estimate-reader";
import { ScheduleJobUseCase } from "./schedule-job";
import { CreateJobFromEstimateUseCase } from "./create-job-from-estimate";
import { StartJobUseCase } from "./start-job";
import { CompleteJobUseCase } from "./complete-job";
import { CancelJobUseCase } from "./cancel-job";
import { AssignJobUseCase } from "./assign-job";
import { ListJobsUseCase } from "./list-jobs";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const EST: EstimateId = asEstimateId("44444444-4444-4444-4444-444444444444");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

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
      return false; // active job already exists for this estimate
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
  async findBySourceEstimate(estimateId: EstimateId): Promise<Job | null> {
    return [...this.store.values()].find((j) => j.props.sourceEstimateId === estimateId) ?? null;
  }
  async list(page: CursorPage, filter?: JobFilter): Promise<Paginated<Job>> {
    let rows = [...this.store.values()].sort((a, b) => {
      const t = b.props.createdAt.getTime() - a.props.createdAt.getTime();
      return t !== 0 ? t : b.props.id.localeCompare(a.props.id);
    });
    if (filter?.status) rows = rows.filter((j) => j.props.status === filter.status);
    if (filter?.assigneeUserId) rows = rows.filter((j) => j.props.assigneeUserId === filter.assigneeUserId);
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        const c = cursor.value;
        rows = rows.filter((j) => {
          const t = j.props.createdAt.getTime();
          return t < c.createdAt.getTime() || (t === c.createdAt.getTime() && j.props.id < c.id);
        });
      }
    }
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
  async saveOnSiteSignature(): Promise<void> {}
  async count(): Promise<number> { return 0; }
  async viewCounts(): Promise<{ counts: Record<string, number>; todayCents: number }> { return { counts: {}, todayCents: 0 } as never; }
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
  async listRecentForCallbackScan() { return []; }
  async listConfirmedCallbacksWithOriginals() { return []; }
}

class FakeEstimateReader implements EstimateReader {
  constructor(private readonly summary: EstimateSummary | null) {}
  async read(estimateId: EstimateId): Promise<EstimateSummary | null> {
    return this.summary && this.summary.id === estimateId ? this.summary : null;
  }
}

const acceptedEstimate = (): EstimateSummary => ({
  id: EST,
  leadId: LEAD,
  title: "Deck",
  status: "accepted",
  // $1,100 total, of which $88 is 8.75% tax on the $1,012 net — a real split, so a use-case that
  // silently dropped it would be caught rather than passing on two zeroes.
  totalCents: 110_000,
  taxBps: 875,
  taxCents: 8_855,
});

describe("ScheduleJobUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;
  let schedule: ScheduleJobUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeJobRepository();
    bus = new InMemoryEventBus();
    schedule = new ScheduleJobUseCase(repo, bus, clock, seqIds());
  });

  const cmd = () => ({
    orgId: ORG,
    leadId: LEAD,
    title: "Direct job",
    scheduledStart: null,
    scheduledEnd: null,
    assigneeUserId: null,
  });

  it("allocates sequential JOB numbers and emits job.scheduled", async () => {
    const a = await schedule.exec(cmd());
    const b = await schedule.exec(cmd());
    expect(isOk(a) && a.value.props.num).toBe("JOB-1000");
    expect(isOk(b) && b.value.props.num).toBe("JOB-1001");
    expect(bus.recorded.filter((e) => e.name === "job.scheduled")).toHaveLength(2);
  });

  it("rejects an inverted window", async () => {
    const r = await schedule.exec({
      ...cmd(),
      scheduledStart: new Date("2026-06-10T12:00:00Z"),
      scheduledEnd: new Date("2026-06-10T09:00:00Z"),
    });
    expect(r.ok).toBe(false);
  });
});

describe("CreateJobFromEstimateUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeJobRepository();
    bus = new InMemoryEventBus();
  });

  const useCase = (reader: EstimateReader) =>
    new CreateJobFromEstimateUseCase(repo, reader, bus, clock, seqIds());

  it("rejects an estimate that is not accepted", async () => {
    const reader = new FakeEstimateReader({ ...acceptedEstimate(), status: "sent" });
    const r = await useCase(reader).exec({ orgId: ORG, estimateId: EST });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
  });

  it("returns not_found for a missing estimate", async () => {
    const r = await useCase(new FakeEstimateReader(null)).exec({ orgId: ORG, estimateId: EST });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("creates a scheduled job snapshotting the estimate total", async () => {
    const r = await useCase(new FakeEstimateReader(acceptedEstimate())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r) && r.value.props.status).toBe("scheduled");
    if (isOk(r)) {
      expect(r.value.props.total).toBe(110_000);
      expect(r.value.props.sourceEstimateId).toBe(EST);
    }
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
  });

  it("is idempotent — a second call returns the same job and emits once", async () => {
    const uc = useCase(new FakeEstimateReader(acceptedEstimate()));
    const first = await uc.exec({ orgId: ORG, estimateId: EST });
    const second = await uc.exec({ orgId: ORG, estimateId: EST });
    expect(isOk(first) && isOk(second) && first.value.props.id === second.value.props.id).toBe(true);
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
  });

  it("seeds exactly one unplaced 120-minute visit at position 1", async () => {
    const r = await useCase(new FakeEstimateReader(acceptedEstimate())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const visits = r.value.props.visits;
    expect(visits).toHaveLength(1);
    const v = visits[0]!.props;
    expect(v.durationMinutes).toBe(120);
    expect(v.position).toBe(1);
    expect(v.status).toBe("pending");
    // Unplaced: no assignee, date, or time window — the office places it from the tray.
    expect(v.assigneeUserId).toBeNull();
    expect(v.scheduledDate).toBeNull();
    expect(v.scheduledStart).toBeNull();
    expect(v.scheduledEnd).toBeNull();
  });

  it("propagates a visit-create failure instead of silently creating a visitless job", async () => {
    const spy = vi
      .spyOn(JobVisit, "create")
      .mockReturnValue(err(validation("visit duration must be 1–1440 whole minutes", "durationMinutes")));
    try {
      const r = await useCase(new FakeEstimateReader(acceptedEstimate())).exec({
        orgId: ORG,
        estimateId: EST,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("validation");
      expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("uses zeroMoney when estimate totalCents is 0", async () => {
    // total = net + tax with both non-negative, so a zero total carries no tax.
    const zeroEstimate: EstimateSummary = { ...acceptedEstimate(), totalCents: 0, taxCents: 0 };
    const r = await useCase(new FakeEstimateReader(zeroEstimate)).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.total).toBe(0);
    }
  });

  it("insert-race: returns the winner when insertForEstimate loses the race but re-fetch succeeds", async () => {
    // Simulate the concurrent double-call case: insertForEstimate signals DO NOTHING (false),
    // but findBySourceEstimate returns the row committed by the winning concurrent request.
    const winnerEstimate = acceptedEstimate();
    // First call succeeds normally to build a winner job in the repo.
    const uc = useCase(new FakeEstimateReader(winnerEstimate));
    const winnerResult = await uc.exec({ orgId: ORG, estimateId: EST });
    expect(isOk(winnerResult)).toBe(true);
    if (!isOk(winnerResult)) return;
    const winnerId = winnerResult.value.props.id;

    // Build a repo that always returns false for insertForEstimate but still has the winner stored.
    // Delegate all other methods to the real repo so nextNumber etc. work.
    class RaceWinnerRepo extends FakeJobRepository {
      override async insertForEstimate(_job: Job): Promise<boolean> {
        return false; // simulate DO NOTHING — we "lost" the insert race
      }
      override async findBySourceEstimate(estimateId: EstimateId): Promise<Job | null> {
        return repo.findBySourceEstimate(estimateId); // re-fetch returns the actual winner
      }
    }
    const racingUc = new CreateJobFromEstimateUseCase(
      new RaceWinnerRepo(),
      new FakeEstimateReader(winnerEstimate),
      bus,
      clock,
      seqIds(),
    );
    const raceResult = await racingUc.exec({ orgId: ORG, estimateId: EST });
    expect(isOk(raceResult)).toBe(true);
    if (isOk(raceResult)) {
      expect(raceResult.value.props.id).toBe(winnerId);
    }
    // The losing racer must not emit a duplicate job.created event.
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
  });

  it("insert-race final conflict: returns conflict error when insertForEstimate returns false and re-fetch finds nothing", async () => {
    // Edge case: insert returned false (DO NOTHING) but the row has since vanished from a
    // subsequent read — surfaces a conflict error rather than silently succeeding or panicking.
    class GhostRepo extends FakeJobRepository {
      override async insertForEstimate(_job: Job): Promise<boolean> {
        return false;
      }
      override async findBySourceEstimate(_estimateId: EstimateId): Promise<Job | null> {
        return null;
      }
    }
    const uc = new CreateJobFromEstimateUseCase(
      new GhostRepo(),
      new FakeEstimateReader(acceptedEstimate()),
      bus,
      clock,
      seqIds(),
    );
    const r = await uc.exec({ orgId: ORG, estimateId: EST });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("conflict");
      expect(r.error.message).toMatch(/already exists/);
    }
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(0);
  });
});

describe("Job lifecycle use-cases", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;

  const seedScheduledJob = async (): Promise<JobId> => {
    const r = await new ScheduleJobUseCase(repo, bus, clock, seqIds()).exec({
      orgId: ORG,
      leadId: LEAD,
      title: "J",
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
  });

  it("start then complete emits their events and enforces the machine", async () => {
    const id = await seedScheduledJob();
    const complete = new CompleteJobUseCase(repo, bus, clock);
    expect((await complete.exec({ jobId: id })).ok).toBe(false); // can't complete a scheduled job

    const started = await new StartJobUseCase(repo, bus, clock).exec({ jobId: id });
    expect(isOk(started) && started.value.props.status).toBe("in_progress");
    const done = await complete.exec({ jobId: id });
    expect(isOk(done) && done.value.props.status).toBe("complete");
    expect(bus.recorded.some((e) => e.name === "job.started")).toBe(true);
    expect(bus.recorded.some((e) => e.name === "job.completed")).toBe(true);
  });

  it("start is idempotent (no duplicate job.started)", async () => {
    const id = await seedScheduledJob();
    const start = new StartJobUseCase(repo, bus, clock);
    await start.exec({ jobId: id });
    await start.exec({ jobId: id });
    expect(bus.recorded.filter((e) => e.name === "job.started")).toHaveLength(1);
  });

  it("cancel requires a reason and returns not_found for a missing job", async () => {
    const id = await seedScheduledJob();
    const cancel = new CancelJobUseCase(repo, bus, clock);
    expect((await cancel.exec({ jobId: id, reason: "  " })).ok).toBe(false);
    const missing = await cancel.exec({
      jobId: asJobId("99999999-9999-9999-9999-999999999999"),
      reason: "x",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("not_found");
    const ok = await cancel.exec({ jobId: id, reason: "customer canceled" });
    expect(isOk(ok) && ok.value.props.status).toBe("canceled");
  });

  it("assign sets and clears the assignee", async () => {
    const id = await seedScheduledJob();
    const user = asUserId("99999999-9999-9999-9999-999999999999");
    const assign = new AssignJobUseCase(repo, bus, clock);
    const assigned = await assign.exec({ jobId: id, assigneeUserId: user });
    expect(isOk(assigned) && assigned.value.props.assigneeUserId).toBe(user);
    const cleared = await assign.exec({ jobId: id, assigneeUserId: null });
    expect(isOk(cleared) && cleared.value.props.assigneeUserId).toBeNull();
  });
});

describe("ListJobsUseCase", () => {
  it("paginates newest-first with a next cursor and status filter", async () => {
    const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    const repo = new FakeJobRepository();
    const bus = new InMemoryEventBus();
    const schedule = new ScheduleJobUseCase(repo, bus, clock, seqIds());
    for (let i = 0; i < 3; i += 1) {
      await schedule.exec({
        orgId: ORG,
        leadId: LEAD,
        title: `J${i}`,
        scheduledStart: null,
        scheduledEnd: null,
        assigneeUserId: null,
      });
      clock.advance(60_000);
    }
    const list = new ListJobsUseCase(repo);
    const page1 = await list.exec({ page: toPage({ limit: 2 }) });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await list.exec({ page: toPage({ limit: 2, cursor: page1.nextCursor }) });
    expect(page2.items).toHaveLength(1);
    const scheduled = await list.exec({ page: toPage(), filter: { status: "scheduled" } });
    expect(scheduled.items).toHaveLength(3);
    const complete = await list.exec({ page: toPage(), filter: { status: "complete" } });
    expect(complete.items).toHaveLength(0);
  });
});
