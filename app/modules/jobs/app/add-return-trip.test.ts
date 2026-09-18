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
import type { IdGenerator } from "@mallet/shared/ports";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "../domain/job";
import type { JobRepository, JobFilter } from "../domain/job-repository";
import type { JobBillingReader, JobBillSummary } from "../domain/return-trip";
import { AddReturnTripUseCase } from "./add-return-trip";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB_ID = asJobId("11111111-1111-1111-1111-111111111111");
const NOW = new Date("2026-08-07T15:00:00Z");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

const makeVisit = (over: Partial<JobVisitProps> = {}): JobVisit => {
  const r = JobVisit.create({
    id: asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes: null,
    status: "pending",
    enrouteAt: null,
    startedAt: null,
    completedAt: null,
    notes: null,
    position: 1,
    ...over,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const makeJob = (over: Partial<JobProps> = {}): Job => {
  const r = Job.create({
    id: JOB_ID,
    orgId: ORG,
    num: "JOB-9001",
    leadId: LEAD,
    taxBps: 0,
    discBps: 0,
    tax: zeroMoney,
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Water heater swap",
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
    requiredCerts: null,
    addr: null,
    phone: null,
    completion: null,
    invRequested: false,
    visits: [],
    createdAt: new Date("2026-08-01T00:00:00Z"),
    updatedAt: new Date("2026-08-01T00:00:00Z"),
    ...over,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

/** A finished job with the trip that ran already on it — the shape the sheet shows after Done. */
const finishedJob = (): Job => {
  const started = makeJob({ visits: [makeVisit({ status: "in_progress" })] }).start(NOW);
  if (!isOk(started)) throw new Error("start failed");
  const done = started.value.complete(NOW);
  if (!isOk(done)) throw new Error("complete failed");
  return done.value;
};

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  /** Every save this use case made — the assertion that the reopen never lands on its own. */
  readonly saves: Job[] = [];
  /** When set, save() throws — standing in for the visit write failing after the reopen. */
  failSave = false;

  seed(job: Job): this {
    this.store.set(job.props.id, job);
    return this;
  }
  saved(id: JobId): Job | undefined {
    return this.store.get(id);
  }

  async save(job: Job): Promise<void> {
    if (this.failSave) throw new Error("write failed");
    this.saves.push(job);
    this.store.set(job.props.id, job);
  }
  async findById(id: JobId): Promise<Job | null> {
    return this.store.get(id) ?? null;
  }
  async nextNumber(): Promise<string> { return "JOB-1000"; }
  async adoptEstimateOnJob(): Promise<boolean> { return false; }
  async insertForEstimate(): Promise<boolean> { return true; }
  async insertManual(): Promise<void> {}
  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> { return 0; }
  async findBySourceEstimate(_id: EstimateId): Promise<Job | null> { return null; }
  async list(_p: CursorPage, _f?: JobFilter): Promise<Paginated<Job>> { return { items: [], nextCursor: null }; }
  async listByLead(_l: LeadId, _p: CursorPage): Promise<Paginated<Job>> { return { items: [], nextCursor: null }; }
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async listExecutionForJobs() { return new Map(); }
  async addLine() {}
  async updateLine() { return 0; }
  async removeLine() { return 0; }
  async replaceLines() {}
  async saveOnSiteSignature(): Promise<void> {}
  async count(): Promise<number> { return 0; }
  async viewCounts(): Promise<{ counts: Record<string, number>; todayCents: number }> {
    return { counts: {}, todayCents: 0 } as never;
  }
  async addAddon() {}
  async approveAddons(): Promise<string[]> { return []; }
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
  async listRecentForCallbackScan() { return []; }
  async listConfirmedCallbacksWithOriginals() { return []; }
}

const billing = (bill: JobBillSummary | null): JobBillingReader => ({
  readBillForJob: async () => bill,
  readBillsForJobs: async () => new Map(),
});

const CMD = { jobId: JOB_ID, reason: "Waiting on the 40-gal tank", durationHours: 1 };

describe("AddReturnTripUseCase — an open job is unchanged", () => {
  let repo: FakeJobRepository;

  beforeEach(() => {
    repo = new FakeJobRepository();
  });

  it("appends an unplaced visit and does not reopen anything", async () => {
    repo.seed(makeJob({ status: "in_progress", visits: [makeVisit()] }));
    const uc = new AddReturnTripUseCase(repo, billing(null), new FixedClock(NOW), seqIds());

    const r = await uc.exec(CMD);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.reopened).toBe(false);
    expect(r.value.job.props.status).toBe("in_progress");
    const added = r.value.job.props.visits[1];
    expect(added?.props.position).toBe(2);
    expect(added?.props.status).toBe("pending");
    expect(added?.props.scheduledDate).toBeNull();
    expect(added?.props.assigneeUserId).toBeNull();
    expect(added?.props.notes).toBe("Waiting on the 40-gal tank");
    expect(added?.props.durationMinutes).toBe(60);
  });
});

describe("AddReturnTripUseCase — THE MONEY RULE, at the server", () => {
  let repo: FakeJobRepository;

  beforeEach(() => {
    repo = new FakeJobRepository().seed(finishedJob());
  });

  it("refuses a finished job whose bill has been paid, and writes nothing", async () => {
    const uc = new AddReturnTripUseCase(
      repo,
      billing({ num: "INV-7", status: "paid", amountPaidCents: 42_000 }),
      new FixedClock(NOW),
      seqIds(),
    );

    const r = await uc.exec(CMD);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("conflict");
    expect(r.error.message).toContain("Payment has already been taken");
    expect(r.error.message).toContain("office");

    // The job is untouched: still finished, still one visit.
    expect(repo.saves).toHaveLength(0);
    expect(repo.saved(JOB_ID)?.props.status).toBe("complete");
    expect(repo.saved(JOB_ID)?.props.visits).toHaveLength(1);
  });

  it("refuses a bill that is already with the customer", async () => {
    const uc = new AddReturnTripUseCase(
      repo,
      billing({ num: "INV-7", status: "sent", amountPaidCents: 0 }),
      new FixedClock(NOW),
      seqIds(),
    );
    const r = await uc.exec(CMD);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: "conflict", field: "bill_out" });
    expect(repo.saves).toHaveLength(0);
  });

  it("refuses a voided bill — the work it would add could never be billed", async () => {
    const uc = new AddReturnTripUseCase(
      repo,
      billing({ num: "INV-7", status: "void", amountPaidCents: 0 }),
      new FixedClock(NOW),
      seqIds(),
    );
    const r = await uc.exec(CMD);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: "conflict", field: "bill_void" });
    expect(repo.saves).toHaveLength(0);
  });

  it("refuses a canceled job", async () => {
    const canceled = makeJob({ status: "canceled", canceledAt: NOW, cancelReason: "customer pulled out" });
    const cancelledRepo = new FakeJobRepository().seed(canceled);
    const uc = new AddReturnTripUseCase(cancelledRepo, billing(null), new FixedClock(NOW), seqIds());

    const r = await uc.exec(CMD);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatchObject({ kind: "conflict", field: "job_canceled" });
    expect(cancelledRepo.saves).toHaveLength(0);
  });
});

describe("AddReturnTripUseCase — reopening a finished job", () => {
  it("reopens and appends in ONE save when there is no bill", async () => {
    const repo = new FakeJobRepository().seed(finishedJob());
    const uc = new AddReturnTripUseCase(repo, billing(null), new FixedClock(NOW), seqIds());

    const r = await uc.exec(CMD);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    expect(r.value.reopened).toBe(true);
    expect(r.value.billIsStale).toBe(false);
    expect(r.value.job.props.status).toBe("in_progress");
    expect(r.value.job.props.completedAt).toBeNull();
    // The trip that ran keeps its completion; the return trip is pending behind it.
    expect(r.value.job.props.visits.map((v) => v.props.status)).toEqual(["complete", "pending"]);

    // ONE write. A second save would mean a moment when the job was reopened with no return trip
    // on it — the window this use case exists to close.
    expect(repo.saves).toHaveLength(1);
    expect(repo.saves[0]?.props.visits).toHaveLength(2);
  });

  it("allows an untouched draft but reports it as stale", async () => {
    const repo = new FakeJobRepository().seed(finishedJob());
    const uc = new AddReturnTripUseCase(
      repo,
      billing({ num: "INV-7", status: "draft", amountPaidCents: 0 }),
      new FixedClock(NOW),
      seqIds(),
    );

    const r = await uc.exec(CMD);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.reopened).toBe(true);
    expect(r.value.billIsStale).toBe(true);
  });

  it("leaves the job finished when the write fails — there is no half-done reopen", async () => {
    const repo = new FakeJobRepository().seed(finishedJob());
    repo.failSave = true;
    const uc = new AddReturnTripUseCase(repo, billing(null), new FixedClock(NOW), seqIds());

    await expect(uc.exec(CMD)).rejects.toThrow("write failed");
    expect(repo.saved(JOB_ID)?.props.status).toBe("complete");
    expect(repo.saved(JOB_ID)?.props.visits).toHaveLength(1);
  });

  it("does not mutate the job it read", async () => {
    const before = finishedJob();
    const repo = new FakeJobRepository().seed(before);
    const uc = new AddReturnTripUseCase(repo, billing(null), new FixedClock(NOW), seqIds());

    await uc.exec(CMD);
    expect(before.props.status).toBe("complete");
    expect(before.props.visits).toHaveLength(1);
  });

  it("returns not_found for a job that does not exist", async () => {
    const repo = new FakeJobRepository();
    const uc = new AddReturnTripUseCase(repo, billing(null), new FixedClock(NOW), seqIds());
    const r = await uc.exec(CMD);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
