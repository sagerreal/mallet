import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asVisitId,
  FixedClock,
  isOk,
  zeroMoney,
  type OrgId,
  type LeadId,
  type JobId,
  type VisitId,
  type EstimateId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";
import { RemoveVisitUseCase, type RemoveVisitCommand } from "./remove-visit";

// ── constants ────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB_ID: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const MISSING_JOB: JobId = asJobId("99999999-9999-9999-9999-999999999999");

const VISIT_A: VisitId = asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const VISIT_B: VisitId = asVisitId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const MISSING_VISIT: VisitId = asVisitId("99999999-9999-9999-9999-999999999999");

// ── FakeJobRepository ────────────────────────────────────────────────────────

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

// ── domain helpers ───────────────────────────────────────────────────────────

const makeVisitProps = (overrides: Partial<JobVisitProps> = {}): JobVisitProps => ({
  id: VISIT_A,
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
  const r = JobVisit.create(makeVisitProps(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const makeJobProps = (overrides: Partial<JobProps> = {}): JobProps => ({
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
  visits: [],
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeJob = (overrides: Partial<JobProps> = {}): Job => {
  const r = Job.create(makeJobProps(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// ── RemoveVisitUseCase ────────────────────────────────────────────────────────

describe("RemoveVisitUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let uc: RemoveVisitUseCase;

  const cmd = (overrides: Partial<RemoveVisitCommand> = {}): RemoveVisitCommand => ({
    jobId: JOB_ID,
    visitId: VISIT_A,
    ...overrides,
  });

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-01T10:00:00Z"));
    repo = new FakeJobRepository();
    uc = new RemoveVisitUseCase(repo, clock);
  });

  // ── not-found: job missing ───────────────────────────────────────────────

  it("returns not_found when the job does not exist", async () => {
    const result = await uc.exec(cmd({ jobId: MISSING_JOB }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/job/i);
    }
  });

  // ── not-found: visit missing (idx === -1) ────────────────────────────────

  it("returns not_found when the visit does not exist on the job (idx = -1)", async () => {
    const visitA = makeVisit({ id: VISIT_A });
    repo.seed(makeJob({ visits: [visitA] }));

    const result = await uc.exec(cmd({ visitId: MISSING_VISIT }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/visit/i);
    }
  });

  // ── happy path: single visit removed ────────────────────────────────────

  it("removes the targeted visit from the job's visits list", async () => {
    const visitA = makeVisit({ id: VISIT_A });
    repo.seed(makeJob({ visits: [visitA] }));

    const result = await uc.exec(cmd({ visitId: VISIT_A }));
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.visits).toHaveLength(0);
    }
  });

  it("removes only the targeted visit when multiple visits exist", async () => {
    const visitA = makeVisit({ id: VISIT_A, position: 1 });
    const visitB = makeVisit({ id: VISIT_B, position: 2 });
    repo.seed(makeJob({ visits: [visitA, visitB] }));

    const result = await uc.exec(cmd({ visitId: VISIT_A }));
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const ids = result.value.props.visits.map((v) => v.props.id);
      expect(ids).not.toContain(VISIT_A);
      expect(ids).toContain(VISIT_B);
      expect(result.value.props.visits).toHaveLength(1);
    }
  });

  // ── persistence ──────────────────────────────────────────────────────────

  it("persists the updated job via repo.save so a subsequent findById reflects removal", async () => {
    const visitA = makeVisit({ id: VISIT_A });
    repo.seed(makeJob({ visits: [visitA] }));

    await uc.exec(cmd({ visitId: VISIT_A }));

    const saved = repo.saved(JOB_ID);
    expect(saved?.props.visits).toHaveLength(0);
  });

  // ── return value ─────────────────────────────────────────────────────────

  it("returns the updated job (not the old job) on success", async () => {
    const visitA = makeVisit({ id: VISIT_A });
    repo.seed(makeJob({ visits: [visitA] }));

    const result = await uc.exec(cmd({ visitId: VISIT_A }));
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      // returned job must not contain the removed visit
      expect(result.value.props.visits.some((v) => v.props.id === VISIT_A)).toBe(false);
    }
  });

  // ── updatedAt stamping ───────────────────────────────────────────────────

  it("bumps updatedAt to the clock's current time on success", async () => {
    const visitA = makeVisit({ id: VISIT_A });
    repo.seed(makeJob({ visits: [visitA] }));

    const result = await uc.exec(cmd({ visitId: VISIT_A }));
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.updatedAt).toEqual(clock.now());
    }
  });

  // ── withVisits error propagation (terminal job) ──────────────────────────

  it("propagates the error from withVisits when the job is in a terminal state", async () => {
    // Build a completed job that still has VISIT_A embedded:
    // scheduled (with visit) → start → complete
    const visitA = makeVisit({ id: VISIT_A });
    const scheduled = makeJob({ visits: [visitA] });

    const withVisitR = scheduled.withVisits([visitA], clock.now());
    if (!isOk(withVisitR)) throw new Error("withVisits setup failed");

    const startedR = withVisitR.value.start(new Date("2026-07-01T08:00:00Z"));
    if (!isOk(startedR)) throw new Error("start failed");

    const completedR = startedR.value.complete(new Date("2026-07-01T09:00:00Z"));
    if (!isOk(completedR)) throw new Error("complete failed");

    repo.seed(completedR.value);

    const result = await uc.exec(cmd({ jobId: completedR.value.props.id, visitId: VISIT_A }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  // ── immutability ─────────────────────────────────────────────────────────

  it("does not mutate the original job — original visits list remains unchanged", async () => {
    const visitA = makeVisit({ id: VISIT_A });
    const original = makeJob({ visits: [visitA] });
    repo.seed(original);

    await uc.exec(cmd({ visitId: VISIT_A }));

    // The in-memory object 'original' must not have been mutated
    expect(original.props.visits).toHaveLength(1);
    expect(original.props.visits[0]?.props.id).toBe(VISIT_A);
  });
});
