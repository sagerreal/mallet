import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asJobId,
  asUserId,
  asVisitId,
  FixedClock,
  toPage,
  buildPage,
  decodeCursor,
  isOk,
  err,
  validation,
  money,
  zeroMoney,
  type OrgId,
  type LeadId,
  type EstimateId,
  type JobId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Job, JobVisit } from "../domain/job";
import type { JobRepository, JobFilter, AdoptEstimatePatch } from "../domain/job-repository";
import type { JobLine } from "../domain/job-execution";
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

  /** Every stored job — lets a test assert "converted, not duplicated" by counting rows. */
  get all(): Job[] {
    return [...this.store.values()];
  }

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
  /** Recorded, not swallowed: the sold scope arriving on the job is the thing to assert. */
  linesWritten: { jobId: string; lines: readonly { props: { description: string; rate: number; quantity: number } }[] }[] = [];
  async replaceLines(jobId: string, lines: readonly never[]) {
    this.linesWritten.push({ jobId, lines });
  }
  /** Every adopt attempt, recorded at ENTRY — proves a fallback actually RAN the convert and
   *  was refused, rather than being skipped by an earlier guard in the use case. */
  adoptAttempts: string[] = [];

  /**
   * Convert-on-accept twin of the Drizzle method: flip the scope-visit job to sold work IN
   * PLACE — no new row. Mirrors the real contract exactly: refuses a missing job, anything
   * already kind='work', and canceled jobs (returns false → the use case falls back to mint);
   * replaces the lines and appends ONE pending visit positioned after the existing ones.
   */
  async adoptEstimateOnJob(
    _orgId: OrgId,
    jobId: JobId,
    patch: AdoptEstimatePatch,
    lines: readonly JobLine[],
    now: Date,
  ): Promise<boolean> {
    this.adoptAttempts.push(jobId);
    const job = this.store.get(jobId);
    if (!job || job.props.kind !== "estimate" || job.props.status === "canceled") return false;
    const maxPos = job.props.visits.reduce((max, v) => Math.max(max, v.props.position), 0);
    const visit = JobVisit.create({
      id: asVisitId(`aaaaaaaa-aaaa-aaaa-aaaa-${String(maxPos + 1).padStart(12, "0")}`),
      assigneeUserId: null,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      durationMinutes: 120,
      status: "pending",
      enrouteAt: null,
      startedAt: null,
      completedAt: null,
      notes: null,
      position: maxPos + 1,
    });
    if (!isOk(visit)) throw new Error("fake visit build failed");
    const flipped = Job.create({
      ...job.props,
      kind: "work",
      sourceEstimateId: asEstimateId(patch.sourceEstimateId),
      title: patch.title,
      svc: null,
      status: "scheduled",
      startedAt: null,
      completedAt: null,
      total: money(patch.totalCents),
      taxBps: patch.taxBps,
      tax: money(patch.taxCents),
      visits: [...job.props.visits, visit.value],
      updatedAt: now,
    });
    if (!isOk(flipped)) throw new Error("fake convert rebuild failed");
    this.store.set(jobId, flipped.value);
    // The real method swaps the lines inside the same tx — record them the same way
    // replaceLines does so the scope-copy assertions read one ledger.
    this.linesWritten.push({ jobId, lines: lines as never[] });
    return true;
  }
  async saveOnSiteSignature(): Promise<void> {}
  async count(): Promise<number> { return 0; }
  async viewCounts(): Promise<{ counts: Record<string, number>; todayCents: number }> { return { counts: {}, todayCents: 0 } as never; }
  async addAddon() {}
  async approveAddons(): Promise<string[]> {
    return [];
  }

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
  // Ordinary office quote: no scope-visit job behind it — accept mints a fresh job.
  jobId: null,
  // $1,100 total, of which $88 is 8.75% tax on the $1,012 net — a real split, so a use-case that
  // silently dropped it would be caught rather than passing on two zeroes.
  totalCents: 110_000,
  taxBps: 875,
  taxCents: 8_855,
  // The sold scope, which the job now carries so a technician can see what was bought.
  lines: [
    { description: "Deck boards — cedar", quantity: 1, rateCents: 80_000, costCents: 40_000, taxable: true, position: 1 },
    { description: "Railing", quantity: 1, rateCents: 21_200, costCents: 9_000, taxable: true, position: 2 },
  ],
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

  // The point of the whole change: a technician opening the job sees WHAT WAS SOLD, not just a
  // price. Before this the job carried a title and a total and the scope stayed on the quote.
  it("copies the sold lines onto the job as its scope", async () => {
    await useCase(new FakeEstimateReader(acceptedEstimate())).exec({ orgId: ORG, estimateId: EST });
    expect(repo.linesWritten).toHaveLength(1);
    const written = repo.linesWritten[0]!.lines;
    expect(written.map((l) => l.props.description)).toEqual(["Deck boards — cedar", "Railing"]);
    expect(written.map((l) => l.props.rate)).toEqual([80_000, 21_200]);
  });

  it("writes no lines for a quote that had none, rather than an empty scope row", async () => {
    const bare = { ...acceptedEstimate(), lines: [] };
    await useCase(new FakeEstimateReader(bare)).exec({ orgId: ORG, estimateId: EST });
    expect(repo.linesWritten).toHaveLength(0);
  });

  // A quote is what was agreed then; a job is what is being done now. Jobber snapshots for the
  // same reason — an edit to the quote after the fact must not silently rewrite live work.
  it("keeps the scope even when it disagrees with the estimate total", async () => {
    // A total that does not equal the sum of the lines is normal — discount and tax sit between
    // them — so the job takes the estimate's snapshotted total AND the estimate's lines, without
    // re-deriving one from the other.
    const odd = { ...acceptedEstimate(), totalCents: 120_000 };
    const r = await useCase(new FakeEstimateReader(odd)).exec({ orgId: ORG, estimateId: EST });
    expect(isOk(r) && r.value.props.total).toBe(120_000);
    expect(repo.linesWritten[0]!.lines).toHaveLength(2);
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

describe("CreateJobFromEstimateUseCase — convert-on-accept (estimate.jobId)", () => {
  const SCOPE_JOB = asJobId("55555555-5555-5555-5555-555555555555");

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

  /** A scope-visit job already on the books: kind='estimate', one completed walkthrough visit. */
  const seedScopeVisitJob = async (
    overrides: Partial<Parameters<typeof Job.create>[0]> = {},
  ): Promise<Job> => {
    const visit = JobVisit.create({
      id: asVisitId("66666666-6666-6666-6666-666666666666"),
      assigneeUserId: null,
      scheduledDate: "2026-05-28",
      scheduledStart: null,
      scheduledEnd: null,
      durationMinutes: 60,
      status: "complete",
      enrouteAt: null,
      startedAt: new Date("2026-05-28T15:00:00Z"),
      completedAt: new Date("2026-05-28T16:00:00Z"),
      notes: "scoped: repipe, drywall patch",
      position: 1,
    });
    if (!isOk(visit)) throw new Error("seed visit failed");
    const job = Job.create({
      id: SCOPE_JOB,
      orgId: ORG,
      num: "JOB-900",
      leadId: LEAD,
      sourceEstimateId: null,
      assigneeUserId: null,
      title: "Walkthrough",
      svc: null,
      kind: "estimate",
      status: "complete",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: new Date("2026-05-28T15:00:00Z"),
      completedAt: new Date("2026-05-28T16:00:00Z"),
      canceledAt: null,
      cancelReason: null,
      total: zeroMoney,
      notes: null,
      checklist: null,
      visits: [visit.value],
      createdAt: new Date("2026-05-28T00:00:00Z"),
      updatedAt: new Date("2026-05-28T16:00:00Z"),
      ...overrides,
    });
    if (!isOk(job)) throw new Error("seed job failed");
    await repo.save(job.value);
    return job.value;
  };

  const estimateWithJob = (): EstimateSummary => ({ ...acceptedEstimate(), jobId: SCOPE_JOB });

  it("(a) converts the scope-visit job in place — no second job, kind flips, scope lands, one visit appended", async () => {
    await seedScopeVisitJob();
    const r = await useCase(new FakeEstimateReader(estimateWithJob())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // The SAME job came back — converted, not duplicated.
    expect(r.value.props.id).toBe(SCOPE_JOB);
    expect(repo.all).toHaveLength(1);
    expect(r.value.props.kind).toBe("work");
    expect(r.value.props.sourceEstimateId).toBe(EST);
    expect(r.value.props.title).toBe("Deck");
    expect(r.value.props.svc).toBeNull(); // stale estimate signal cleared (mint sets svc null too)
    expect(r.value.props.total).toBe(110_000);
    expect(r.value.props.taxBps).toBe(875);
    expect(r.value.props.tax).toBe(8_855);

    // The sold scope replaced the (empty) walkthrough lines.
    expect(repo.linesWritten).toHaveLength(1);
    expect(repo.linesWritten[0]!.jobId).toBe(SCOPE_JOB);
    expect(repo.linesWritten[0]!.lines.map((l) => l.props.description)).toEqual([
      "Deck boards — cedar",
      "Railing",
    ]);

    // ONE new pending visit, appended AFTER the walkthrough — history stays intact.
    const visits = r.value.props.visits;
    expect(visits).toHaveLength(2);
    expect(visits[0]!.props.status).toBe("complete"); // the walkthrough, untouched
    const appended = visits[1]!.props;
    expect(appended.status).toBe("pending");
    expect(appended.position).toBe(2);

    // Vocabulary: an existing job changing is job.updated, never a second job.created.
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(0);
    expect(bus.recorded.filter((e) => e.name === "job.updated")).toHaveLength(1);
  });

  it("(b) no jobId on the estimate → mints a fresh job exactly as before", async () => {
    await seedScopeVisitJob();
    const r = await useCase(new FakeEstimateReader(acceptedEstimate())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.id).not.toBe(SCOPE_JOB);
    expect(repo.all).toHaveLength(2); // walkthrough untouched + the minted work job
    const scope = await repo.findById(SCOPE_JOB);
    expect(scope!.props.kind).toBe("estimate");
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
  });

  it("(c) re-accept is idempotent — returns the converted job, no second visit, no second event", async () => {
    await seedScopeVisitJob();
    const uc = useCase(new FakeEstimateReader(estimateWithJob()));
    const first = await uc.exec({ orgId: ORG, estimateId: EST });
    const second = await uc.exec({ orgId: ORG, estimateId: EST });
    expect(isOk(first) && isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value.props.id).toBe(SCOPE_JOB);
    expect(second.value.props.visits).toHaveLength(2); // walkthrough + ONE appended visit, not two
    expect(repo.all).toHaveLength(1);
    expect(bus.recorded.filter((e) => e.name === "job.updated")).toHaveLength(1);
  });

  it("(d) jobId pointing at a kind='work' job with a different source → falls back to mint, never mangles it", async () => {
    const OTHER_EST = asEstimateId("77777777-7777-7777-7777-777777777777");
    await seedScopeVisitJob({
      kind: "work",
      sourceEstimateId: OTHER_EST,
      title: "Someone else's sold work",
      status: "scheduled",
      total: money(50_000),
    });
    const r = await useCase(new FakeEstimateReader(estimateWithJob())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.id).not.toBe(SCOPE_JOB);
    expect(r.value.props.sourceEstimateId).toBe(EST);
    // The hand-linked work job is exactly as it was.
    const untouched = await repo.findById(SCOPE_JOB);
    expect(untouched!.props.sourceEstimateId).toBe(OTHER_EST);
    expect(untouched!.props.title).toBe("Someone else's sold work");
    expect(untouched!.props.total).toBe(50_000);
    expect(untouched!.props.visits).toHaveLength(1);
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
    expect(bus.recorded.filter((e) => e.name === "job.updated")).toHaveLength(0);
  });

  it("(f) a CANCELED walkthrough refuses conversion — adopt RUNS, returns false, accept mints", async () => {
    await seedScopeVisitJob({
      status: "canceled",
      canceledAt: new Date("2026-05-30T00:00:00Z"),
      cancelReason: "customer canceled the walkthrough",
    });
    const r = await useCase(new FakeEstimateReader(estimateWithJob())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // The convert path genuinely EXECUTED and was refused — this is the adopted===false → mint
    // branch, not one of the earlier guards (missing job / work-kind) that never reach adopt.
    expect(repo.adoptAttempts).toEqual([SCOPE_JOB]);

    // The fallback minted a fresh work job; the canceled walkthrough was never resurrected.
    expect(r.value.props.id).not.toBe(SCOPE_JOB);
    expect(r.value.props.sourceEstimateId).toBe(EST);
    expect(repo.all).toHaveLength(2);
    const untouched = await repo.findById(SCOPE_JOB);
    expect(untouched!.props.kind).toBe("estimate");
    expect(untouched!.props.status).toBe("canceled");
    expect(untouched!.props.visits).toHaveLength(1); // no pending visit seeded onto the corpse

    // The sold scope landed on the MINTED job, not the canceled walkthrough.
    expect(repo.linesWritten).toHaveLength(1);
    expect(repo.linesWritten[0]!.jobId).toBe(r.value.props.id);

    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
    expect(bus.recorded.filter((e) => e.name === "job.updated")).toHaveLength(0);
  });

  it("jobId pointing at a job that no longer exists → mints rather than failing the accept", async () => {
    const r = await useCase(new FakeEstimateReader(estimateWithJob())).exec({
      orgId: ORG,
      estimateId: EST,
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.sourceEstimateId).toBe(EST);
    expect(bus.recorded.filter((e) => e.name === "job.created")).toHaveLength(1);
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

  it("start then complete emits their events", async () => {
    const id = await seedScheduledJob();
    const started = await new StartJobUseCase(repo, bus, clock).exec({ jobId: id });
    expect(isOk(started) && started.value.props.status).toBe("in_progress");
    const done = await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id });
    expect(isOk(done) && done.value.props.status).toBe("complete");
    expect(bus.recorded.some((e) => e.name === "job.started")).toBe(true);
    expect(bus.recorded.some((e) => e.name === "job.completed")).toBe(true);
  });

  // "MARK IT COMPLETE" MEANS THE WORK IS DONE — it is not a claim that somebody remembered to
  // press Start first.
  //
  // complete() alone requires in_progress, and nothing in this business sits in in_progress at
  // rest: a job is scheduled until the technician taps, and the office closing out yesterday's
  // work is looking at a scheduled job. The field's own Done endpoint already knew this and
  // pre-started the job itself (field-router). The office endpoint and the AI assistant called
  // this use case raw, so every "mark JOB-… complete" from the chat died on
  // "only an in-progress job can be completed" — verified against the live DB, where EVERY
  // open Summit job refused.
  //
  // The rule belongs here, once, so all three callers behave the same way.
  it("completes a SCHEDULED job when the caller opts in — this is what the chat needs", async () => {
    const id = await seedScheduledJob();
    const done = await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id, startIfScheduled: true });
    expect(isOk(done) && done.value.props.status).toBe("complete");
  });

  it("still refuses a SCHEDULED job by default — the office guard is deliberate", async () => {
    // A dispatcher closing a job nobody has been to is a mistake, not a shortcut. Only the caller
    // that means "the work is done" passes the flag.
    const id = await seedScheduledJob();
    expect((await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id })).ok).toBe(false);
  });

  it("records the start it performed, so the event log does not show a job completing that never began", async () => {
    const id = await seedScheduledJob();
    await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id, startIfScheduled: true });
    expect(bus.recorded.filter((e) => e.name === "job.started")).toHaveLength(1);
    expect(bus.recorded.filter((e) => e.name === "job.completed")).toHaveLength(1);
  });

  it("still refuses a CANCELED job — auto-start must not resurrect terminal work", async () => {
    const id = await seedScheduledJob();
    await new CancelJobUseCase(repo, bus, clock).exec({ jobId: id, reason: "customer called off" });
    const done = await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id, startIfScheduled: true });
    expect(done.ok).toBe(false);
  });

  it("still refuses a job that is ALREADY complete — no second job.completed", async () => {
    const id = await seedScheduledJob();
    await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id, startIfScheduled: true });
    const again = await new CompleteJobUseCase(repo, bus, clock).exec({ jobId: id, startIfScheduled: true });
    expect(again.ok).toBe(false);
    expect(bus.recorded.filter((e) => e.name === "job.completed")).toHaveLength(1);
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
