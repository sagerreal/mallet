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
  type CursorPage,
  type Paginated,
  buildPage,
} from "@mallet/shared/types";
import { Job, JobVisit, type JobVisitProps, type VisitStatus } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { SetVisitEnrouteUseCase } from "./set-visit-enroute";

// ── constants ────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const MISSING_JOB: JobId = asJobId("99999999-9999-9999-9999-999999999999");
const VISIT_A: VisitId = asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const MISSING_VISIT: VisitId = asVisitId("99999999-9999-9999-9999-999999999999");

const SEED_NOW = new Date("2026-07-01T14:00:00Z");
// The tech taps On my way some minutes into the shift, so a stamp equal to the seed time
// would prove nothing about which clock reading was written.
const TAP_DELAY_MS = 7 * 60_000;

// ── FakeJobRepository ────────────────────────────────────────────────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  /** Every save() the use-case performed — proves a no-op really wrote nothing. */
  readonly saves: Job[] = [];

  async nextNumber(): Promise<string> { return "JOB-1"; }

  async save(job: Job): Promise<void> {
    this.saves.push(job);
    this.store.set(job.props.id, job);
  }

  /** Seed without recording a save. */
  seed(job: Job): void {
    this.store.set(job.props.id, job);
  }

  async findById(id: JobId): Promise<Job | null> {
    return this.store.get(id) ?? null;
  }

  async insertForEstimate(): Promise<boolean> { return true; }
  async insertManual(): Promise<void> {}
  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> { return 0; }
  async findBySourceEstimate(): Promise<Job | null> { return null; }
  async list(page: CursorPage): Promise<Paginated<Job>> {
    return buildPage([], page, (j: Job) => ({ createdAt: j.props.createdAt, id: j.props.id }));
  }
  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Job>> {
    return this.list(page);
  }
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async listExecutionForJobs() { return new Map(); }
  async addLine() {}
  async updateLine() { return 0; }
  async removeLine() { return 0; }
  async replaceLines() {}
  async saveOnSiteSignature(): Promise<void> {}
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

// ── domain helpers ───────────────────────────────────────────────────────────

const makeVisit = (overrides: Partial<JobVisitProps> = {}): JobVisit => {
  const r = JobVisit.create({
    id: VISIT_A,
    assigneeUserId: null,
    scheduledDate: "2026-07-01",
    scheduledStart: "09:00",
    scheduledEnd: "11:00",
    durationMinutes: 120,
    status: "pending",
    enrouteAt: null,
    startedAt: null,
    completedAt: null,
    notes: null,
    position: 1,
    ...overrides,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const makeJob = (visits: readonly JobVisit[], status: "scheduled" | "complete" = "scheduled"): Job => {
  const r = Job.create({
    id: JOB,
    orgId: ORG,
    num: "JOB-1",
    leadId: LEAD,
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Water heater",
    svc: null,
    status,
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: status === "complete" ? SEED_NOW : null,
    canceledAt: null,
    cancelReason: null,
    total: zeroMoney,
    notes: null,
    checklist: null,
    visits,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const visitOf = (job: Job): JobVisitProps | undefined =>
  job.props.visits.find((v) => v.props.id === VISIT_A)?.props;

// ── SetVisitEnrouteUseCase ───────────────────────────────────────────────────

describe("SetVisitEnrouteUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let useCase: SetVisitEnrouteUseCase;

  beforeEach(() => {
    clock = new FixedClock(SEED_NOW);
    repo = new FakeJobRepository();
    useCase = new SetVisitEnrouteUseCase(repo, clock);
  });

  it("stamps enrouteAt with clock.now() and persists it", async () => {
    repo.seed(makeJob([makeVisit()]));
    clock.advance(TAP_DELAY_MS);
    const tappedAt = clock.now();

    const result = await useCase.exec({ jobId: JOB, visitId: VISIT_A });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(visitOf(result.value)?.enrouteAt).toEqual(tappedAt);
    // The stamp must be readable AFTER the write, not merely present on the returned value.
    const reread = await repo.findById(JOB);
    expect(reread && visitOf(reread)?.enrouteAt).toEqual(tappedAt);
  });

  it("leaves the visit pending — enroute is a stamp, not a fifth status", async () => {
    repo.seed(makeJob([makeVisit()]));

    const result = await useCase.exec({ jobId: JOB, visitId: VISIT_A });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(visitOf(result.value)?.status).toBe("pending");
      expect(visitOf(result.value)?.startedAt).toBeNull();
      expect(result.value.props.status).toBe("scheduled");
    }
  });

  it("does not move the stamp on a second tap, and writes nothing", async () => {
    repo.seed(makeJob([makeVisit()]));
    const first = await useCase.exec({ jobId: JOB, visitId: VISIT_A });
    expect(isOk(first)).toBe(true);
    const firstStamp = isOk(first) ? visitOf(first.value)?.enrouteAt : null;
    const savesAfterFirst = repo.saves.length;

    clock.advance(TAP_DELAY_MS);
    const second = await useCase.exec({ jobId: JOB, visitId: VISIT_A });

    expect(isOk(second)).toBe(true);
    if (isOk(second)) expect(visitOf(second.value)?.enrouteAt).toEqual(firstStamp);
    expect(repo.saves).toHaveLength(savesAfterFirst);
  });

  it.each<VisitStatus>(["in_progress", "complete", "canceled"])(
    "refuses to stamp a %s visit",
    async (status) => {
      repo.seed(makeJob([makeVisit({ status })]));

      const result = await useCase.exec({ jobId: JOB, visitId: VISIT_A });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("validation");
        expect(result.error.message).toContain(status);
      }
      expect(repo.saves).toHaveLength(0);
    },
  );

  it("returns not_found when the job does not exist", async () => {
    const result = await useCase.exec({ jobId: MISSING_JOB, visitId: VISIT_A });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/job/i);
    }
  });

  it("returns not_found when the visit is not on the job", async () => {
    repo.seed(makeJob([makeVisit()]));

    const result = await useCase.exec({ jobId: JOB, visitId: MISSING_VISIT });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/visit/i);
    }
  });

  it("refuses to touch a visit on a finished job", async () => {
    repo.seed(makeJob([makeVisit()], "complete"));

    const result = await useCase.exec({ jobId: JOB, visitId: VISIT_A });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
    expect(repo.saves).toHaveLength(0);
  });
});
