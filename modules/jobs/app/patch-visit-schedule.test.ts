import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asUserId,
  asVisitId,
  FixedClock,
  isOk,
  type OrgId,
  type LeadId,
  type JobId,
  type VisitId,
  type UserId,
  type CursorPage,
  type Paginated,
  buildPage,
  decodeCursor,
  zeroMoney,
  toPage,
} from "@mallet/shared/types";
import type { EstimateId } from "@mallet/shared/types";
import { Job, JobVisit, type JobVisitProps, type JobProps } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";
import { PatchVisitScheduleUseCase } from "./patch-visit-schedule";

// ── shared constants ──────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB_ID: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const VISIT_ID: VisitId = asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const OTHER_VISIT_ID: VisitId = asVisitId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
const USER_ID: UserId = asUserId("99999999-9999-9999-9999-999999999999");
const UNKNOWN_JOB_ID: JobId = asJobId("00000000-0000-0000-0000-000000000000");
const UNKNOWN_VISIT_ID: VisitId = asVisitId("ffffffff-ffff-ffff-ffff-ffffffffffff");

// ── in-memory fake ────────────────────────────────────────────────────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  private seq = 1000;

  seed(job: Job): void {
    this.store.set(job.props.id, job);
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
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
}

// ── domain helpers ────────────────────────────────────────────────────────────

const visitProps = (overrides: Partial<JobVisitProps> = {}): JobVisitProps => ({
  id: VISIT_ID,
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

// ── PatchVisitScheduleUseCase ─────────────────────────────────────────────────

describe("PatchVisitScheduleUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let useCase: PatchVisitScheduleUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-01T12:00:00Z"));
    repo = new FakeJobRepository();
    useCase = new PatchVisitScheduleUseCase(repo, clock);
  });

  // ── not-found paths ───────────────────────────────────────────────────────

  it("returns not_found when the job does not exist in the repository", async () => {
    const result = await useCase.exec({
      jobId: UNKNOWN_JOB_ID,
      visitId: VISIT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("returns not_found (idx=-1) when visitId is absent from the job's visit list", async () => {
    const job = makeJob({ visits: [makeVisit()] }); // job has VISIT_ID, not UNKNOWN_VISIT_ID
    repo.seed(job);

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: UNKNOWN_VISIT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("returns not_found when job has an empty visits array (undefined guard after idx check)", async () => {
    // visits is empty so findIndex returns -1 immediately — still exercises the guard
    const job = makeJob({ visits: [] });
    repo.seed(job);

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  // ── optional-field undefined vs. provided branches ────────────────────────

  it("happy path: updates all provided optional fields and saves the result", async () => {
    const visit = makeVisit({ scheduledStart: "08:00", scheduledEnd: "10:00" });
    repo.seed(makeJob({ visits: [visit] }));

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      assigneeUserId: USER_ID,
      scheduledDate: "2026-07-15",
      scheduledStart: "09:00",
      scheduledEnd: "11:00",
      notes: "bring ladder",
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updated = result.value.props.visits[0];
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(updated.props.assigneeUserId).toBe(USER_ID);
    expect(updated.props.scheduledDate).toBe("2026-07-15");
    expect(updated.props.scheduledStart).toBe("09:00");
    expect(updated.props.scheduledEnd).toBe("11:00");
    expect(updated.props.notes).toBe("bring ladder");
    // updatedAt must be bumped to clock.now()
    expect(result.value.props.updatedAt).toEqual(clock.now());
  });

  it("preserves existing field values when corresponding command fields are undefined (not provided)", async () => {
    const visit = makeVisit({
      assigneeUserId: USER_ID,
      scheduledDate: "2026-07-10",
      scheduledStart: "08:00",
      scheduledEnd: "10:00",
      notes: "existing note",
    });
    repo.seed(makeJob({ visits: [visit] }));

    // Send command with NO optional fields — everything should be retained
    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      // assigneeUserId, scheduledDate, scheduledStart, scheduledEnd, notes are all undefined
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updated = result.value.props.visits[0];
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(updated.props.assigneeUserId).toBe(USER_ID);
    expect(updated.props.scheduledDate).toBe("2026-07-10");
    expect(updated.props.scheduledStart).toBe("08:00");
    expect(updated.props.scheduledEnd).toBe("10:00");
    expect(updated.props.notes).toBe("existing note");
  });

  it("clears a field to null when the command explicitly provides null", async () => {
    const visit = makeVisit({
      assigneeUserId: USER_ID,
      scheduledDate: "2026-07-10",
      scheduledStart: "08:00",
      scheduledEnd: "10:00",
      notes: "existing note",
    });
    repo.seed(makeJob({ visits: [visit] }));

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      assigneeUserId: null,
      scheduledDate: null,
      scheduledStart: null,
      scheduledEnd: null,
      notes: null,
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updated = result.value.props.visits[0];
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(updated.props.assigneeUserId).toBeNull();
    expect(updated.props.scheduledDate).toBeNull();
    expect(updated.props.scheduledStart).toBeNull();
    expect(updated.props.scheduledEnd).toBeNull();
    expect(updated.props.notes).toBeNull();
  });

  it("partially patches only scheduledDate leaving other fields unchanged", async () => {
    const visit = makeVisit({
      assigneeUserId: USER_ID,
      scheduledDate: "2026-07-10",
      scheduledStart: "08:00",
      scheduledEnd: "10:00",
      notes: "keep me",
    });
    repo.seed(makeJob({ visits: [visit] }));

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      scheduledDate: "2026-07-20", // only this field provided
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updated = result.value.props.visits[0];
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(updated.props.scheduledDate).toBe("2026-07-20");
    // All other fields preserved
    expect(updated.props.assigneeUserId).toBe(USER_ID);
    expect(updated.props.scheduledStart).toBe("08:00");
    expect(updated.props.scheduledEnd).toBe("10:00");
    expect(updated.props.notes).toBe("keep me");
  });

  it("patches only the notes field, leaving scheduling fields intact", async () => {
    const visit = makeVisit({
      scheduledDate: "2026-07-10",
      scheduledStart: "08:00",
      scheduledEnd: "10:00",
      notes: "old note",
    });
    repo.seed(makeJob({ visits: [visit] }));

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      notes: "new note",
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updated = result.value.props.visits[0];
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(updated.props.notes).toBe("new note");
    expect(updated.props.scheduledDate).toBe("2026-07-10");
    expect(updated.props.scheduledStart).toBe("08:00");
    expect(updated.props.scheduledEnd).toBe("10:00");
  });

  it("patches only assigneeUserId, leaving other fields intact", async () => {
    const otherUser: UserId = asUserId("88888888-8888-8888-8888-888888888888");
    const visit = makeVisit({
      assigneeUserId: otherUser,
      scheduledDate: "2026-07-05",
      scheduledStart: "07:00",
      scheduledEnd: "09:00",
      notes: "keep",
    });
    repo.seed(makeJob({ visits: [visit] }));

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      assigneeUserId: USER_ID,
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const updated = result.value.props.visits[0];
    expect(updated).toBeDefined();
    if (!updated) return;

    expect(updated.props.assigneeUserId).toBe(USER_ID);
    expect(updated.props.scheduledDate).toBe("2026-07-05");
    expect(updated.props.scheduledStart).toBe("07:00");
    expect(updated.props.scheduledEnd).toBe("09:00");
    expect(updated.props.notes).toBe("keep");
  });

  // ── immutability / correctness ────────────────────────────────────────────

  it("does not mutate other visits in the job when patching one", async () => {
    const visitA = makeVisit({
      id: VISIT_ID,
      position: 1,
      notes: "visit A",
    });
    const visitB = makeVisit({
      id: OTHER_VISIT_ID,
      position: 2,
      scheduledDate: "2026-07-12",
      scheduledStart: "14:00",
      scheduledEnd: "16:00",
      notes: "visit B",
    });
    repo.seed(makeJob({ visits: [visitA, visitB] }));

    const result = await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      notes: "updated A",
    });

    expect(result.ok).toBe(true);
    if (!isOk(result)) return;

    const visits = result.value.props.visits;
    expect(visits).toHaveLength(2);

    const patchedA = visits.find((v) => v.props.id === VISIT_ID);
    const untouchedB = visits.find((v) => v.props.id === OTHER_VISIT_ID);

    expect(patchedA?.props.notes).toBe("updated A");
    expect(untouchedB?.props.scheduledDate).toBe("2026-07-12");
    expect(untouchedB?.props.notes).toBe("visit B");
  });

  it("persists the updated job to the repository", async () => {
    const visit = makeVisit();
    repo.seed(makeJob({ visits: [visit] }));

    await useCase.exec({
      jobId: JOB_ID,
      visitId: VISIT_ID,
      notes: "persisted",
    });

    // Read back from repo to confirm save() was called
    const saved = await repo.findById(JOB_ID);
    expect(saved).not.toBeNull();
    if (!saved) return;

    const savedVisit = saved.props.visits.find((v) => v.props.id === VISIT_ID);
    expect(savedVisit?.props.notes).toBe("persisted");
  });
});
