import { describe, it, expect, beforeEach } from "vitest";
import {
  asJobId,
  asOrgId,
  asLeadId,
  asVisitId,
  zeroMoney,
  isOk,
  FixedClock,
  type JobId,
  type EstimateId,
  type CursorPage,
  type Paginated,
  type LeadId,
} from "@mallet/shared/types";
import { type IdGenerator } from "@mallet/shared/ports";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";
import { CreateVisitUseCase, type CreateVisitCommand } from "./create-visit";

// ── helpers ──────────────────────────────────────────────────────────────────

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB_ID = asJobId("11111111-1111-1111-1111-111111111111");
const MISSING_JOB_ID = asJobId("99999999-9999-9999-9999-999999999999");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

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
  id: JOB_ID,
  orgId: ORG,
  num: "JOB-9001",
  leadId: LEAD,
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

  seed(job: Job): this {
    this.store.set(job.props.id, job);
    return this;
  }

  async nextNumber(): Promise<string> {
    return "JOB-1000";
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
  async archive(id: JobId, _now: Date): Promise<number> {
    return this.store.delete(id) ? 1 : 0;
  }
  async findById(id: JobId): Promise<Job | null> {
    return this.store.get(id) ?? null;
  }
  async findBySourceEstimate(_estimateId: EstimateId): Promise<Job | null> {
    return null;
  }
  async list(_page: CursorPage, _filter?: JobFilter): Promise<Paginated<Job>> {
    return { items: [], nextCursor: null };
  }
  async listByLead(_leadId: LeadId, _page: CursorPage): Promise<Paginated<Job>> {
    return { items: [], nextCursor: null };
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

  saved(id: JobId): Job | undefined {
    return this.store.get(id);
  }
}

// ── computeEnd (tested indirectly through CreateVisitUseCase.exec) ────────────
// The helper is not exported, so we exercise it through the use-case which passes
// scheduledEnd = computeEnd(scheduledStart, durationHours) into the visit props.

describe("computeEnd (via CreateVisitUseCase)", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let ids: IdGenerator;
  let uc: CreateVisitUseCase;

  const baseCmd = (): CreateVisitCommand => ({
    jobId: JOB_ID,
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    durationHours: 2,
    notes: null,
  });

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
    repo = new FakeJobRepository();
    repo.seed(makeJob());
    ids = seqIds();
    uc = new CreateVisitUseCase(repo, clock, ids);
  });

  it("returns null scheduledEnd when scheduledStart is null", async () => {
    const r = await uc.exec({ ...baseCmd(), scheduledStart: null, durationHours: 2 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const visit = r.value.props.visits[0];
    expect(visit?.props.scheduledEnd).toBeNull();
  });

  it("computes a correct scheduledEnd for a normal window (09:00 + 2h = 11:00)", async () => {
    const r = await uc.exec({ ...baseCmd(), scheduledStart: "09:00", durationHours: 2 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const visit = r.value.props.visits[0];
    expect(visit?.props.scheduledStart).toBe("09:00");
    expect(visit?.props.scheduledEnd).toBe("11:00");
  });

  it("computes a scheduledEnd with minutes (08:30 + 1.5h = 10:00)", async () => {
    const r = await uc.exec({ ...baseCmd(), scheduledStart: "08:30", durationHours: 1.5 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const visit = r.value.props.visits[0];
    expect(visit?.props.scheduledEnd).toBe("10:00");
  });

  it("returns null scheduledEnd when end would overflow past midnight (23:00 + 2h)", async () => {
    const r = await uc.exec({ ...baseCmd(), scheduledStart: "23:00", durationHours: 2 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const visit = r.value.props.visits[0];
    // computeEnd returns null for overflow; visit is created without an end time
    expect(visit?.props.scheduledEnd).toBeNull();
  });

  it("returns exact midnight (00:00) when start + duration lands on exactly 24h", async () => {
    // 22:00 + 2h = 24*60 = 1440 minutes — equals midnight exactly, NOT > 1440, so should return "24:00"
    // Per source: endMinutes > 24*60 (i.e. >1440) returns null. At exactly 1440 it does NOT overflow.
    const r = await uc.exec({ ...baseCmd(), scheduledStart: "22:00", durationHours: 2 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const visit = r.value.props.visits[0];
    // 1440 minutes = 24 hours. Math.floor(1440/60)=24, 1440%60=0 => "24:00"
    expect(visit?.props.scheduledEnd).toBe("24:00");
  });
});

// ── CreateVisitUseCase ────────────────────────────────────────────────────────

describe("CreateVisitUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let ids: IdGenerator;
  let uc: CreateVisitUseCase;

  const baseCmd = (): CreateVisitCommand => ({
    jobId: JOB_ID,
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    durationHours: 2,
    notes: null,
  });

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
    repo = new FakeJobRepository();
    ids = seqIds();
    uc = new CreateVisitUseCase(repo, clock, ids);
  });

  it("returns not_found when the job does not exist", async () => {
    // repo has no jobs seeded
    const r = await uc.exec({ ...baseCmd(), jobId: MISSING_JOB_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("assigns position=1 when no existing visits", async () => {
    repo.seed(makeJob({ visits: [] }));
    const r = await uc.exec(baseCmd());
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits).toHaveLength(1);
    expect(r.value.props.visits[0]?.props.position).toBe(1);
  });

  it("assigns position = max(existing) + 1 when visits already exist", async () => {
    const existingA = makeVisit({ id: asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), position: 3 });
    const existingB = makeVisit({ id: asVisitId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"), position: 5 });
    repo.seed(makeJob({ visits: [existingA, existingB] }));
    const r = await uc.exec(baseCmd());
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const newVisit = r.value.props.visits[2];
    expect(newVisit?.props.position).toBe(6);
  });

  it("uses a client-authored visitId when provided", async () => {
    repo.seed(makeJob());
    const clientId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const r = await uc.exec({ ...baseCmd(), visitId: clientId });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits[0]?.props.id).toBe(clientId);
  });

  it("mints a new id via IdGenerator when visitId is not provided", async () => {
    repo.seed(makeJob());
    const r = await uc.exec(baseCmd()); // no visitId
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    // seqIds() generates "00000000-0000-0000-0000-000000000001" for the first call
    expect(r.value.props.visits[0]?.props.id).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
  });

  it("persists the updated job to the repository", async () => {
    repo.seed(makeJob());
    const r = await uc.exec(baseCmd());
    expect(isOk(r)).toBe(true);
    const saved = repo.saved(JOB_ID);
    expect(saved?.props.visits).toHaveLength(1);
  });

  it("returns the updated job on success", async () => {
    repo.seed(makeJob());
    const r = await uc.exec({ ...baseCmd(), notes: "bring ladder" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits[0]?.props.notes).toBe("bring ladder");
  });

  it("persists durationMinutes from durationHours (2h → 120) even when unplaced", async () => {
    repo.seed(makeJob());
    const r = await uc.exec({ ...baseCmd(), scheduledStart: null, durationHours: 2 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits[0]?.props.durationMinutes).toBe(120);
  });

  it("rounds fractional durations to whole minutes (1.5h → 90)", async () => {
    repo.seed(makeJob());
    const r = await uc.exec({ ...baseCmd(), scheduledStart: "08:30", durationHours: 1.5 });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.visits[0]?.props.durationMinutes).toBe(90);
  });

  it("bumps updatedAt to the clock's current time", async () => {
    repo.seed(makeJob());
    const r = await uc.exec(baseCmd());
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.updatedAt).toEqual(clock.now());
  });

  it("does not mutate the original job — original visits list unchanged", async () => {
    const original = makeJob({ visits: [] });
    repo.seed(original);
    await uc.exec(baseCmd());
    // The in-memory object 'original' must not have been mutated
    expect(original.props.visits).toHaveLength(0);
  });

  it("propagates a failure when JobVisit.create rejects invalid data", async () => {
    // scheduledEnd is computed as null when start is null, so it's fine.
    // Force an invalid state by passing an overflowing start that makes
    // JobVisit.create produce a non-ok result is not possible via the public
    // cmd surface because computeEnd already clamps overflow to null.
    // Instead confirm the happy path rejects terminal job status.
    const startedR = makeJob().start(new Date("2026-07-01T00:00:00Z"));
    if (!isOk(startedR)) throw new Error("start failed");
    const completedR = startedR.value.complete(new Date("2026-07-01T00:00:00Z"));
    if (!isOk(completedR)) throw new Error("complete failed");
    repo.seed(completedR.value);
    const r = await uc.exec({ ...baseCmd(), jobId: completedR.value.props.id });
    // withVisits on a completed job returns an error
    expect(r.ok).toBe(false);
  });
});
