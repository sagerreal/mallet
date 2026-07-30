import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, asLeadId, FixedClock, isOk, zeroMoney } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository, CallbackScanRow } from "../domain/job-repository";
import { ConfirmCallbackUseCase } from "./confirm-callback";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JID = asJobId("11111111-1111-1111-1111-111111111111");
const ORIG_JID = asJobId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const NOW = new Date("2026-07-15T00:00:00Z");

function makeJob(id = JID): Job {
  const r = Job.create({
    id,
    orgId: ORG,
    num: "JOB-1",
    leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Test",
    svc: "drain cleaning",
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
    createdAt: new Date("2026-07-10T00:00:00Z"),
    updatedAt: new Date("2026-07-10T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error("setup");
  return r.value;
}

class FakeRepo implements JobRepository {
  saved?: Job;
  private jobs: Map<string, Job>;

  constructor(jobs: Job[] = []) {
    this.jobs = new Map(jobs.map((j) => [j.props.id as string, j]));
  }

  async listRecentForCallbackScan(): Promise<CallbackScanRow[]> { return []; }
  async listConfirmedCallbacksWithOriginals() { return []; }
  async nextNumber() { return "JOB-1"; }
  async save(j: Job) { this.saved = j; this.jobs.set(j.props.id as string, j); }
  async insertManual(j: Job) { this.saved = j; }
  async archiveByLead(): Promise<number> { return 0; }
  async archive() { return 1; }
  async insertForEstimate() { return true; }
  async findById(id: import("@mallet/shared/types").JobId) { return this.jobs.get(id as string) ?? null; }
  async findBySourceEstimate() { return null; }
  async list() { return { items: [], nextCursor: null }; }
  async listByLead() { return { items: [], nextCursor: null }; }
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async listExecutionForJobs() { return new Map(); }
  async addLine() {}
  async updateLine() { return 0; }
  async removeLine() { return 0; }
  async replaceLines() {}
  async saveOnSiteSignature(): Promise<void> {}
  async count(): Promise<number> { return 0; }
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
}

describe("ConfirmCallbackUseCase", () => {
  let clock: FixedClock;
  beforeEach(() => { clock = new FixedClock(NOW); });

  it("sets callbackOf + reason and saves", async () => {
    const job = makeJob(JID);
    const original = makeJob(ORIG_JID);
    const repo = new FakeRepo([job, original]);
    const bus = new InMemoryEventBus();
    const uc = new ConfirmCallbackUseCase(repo, bus, clock);
    const r = await uc.exec({ jobId: JID, originalJobId: ORIG_JID, reason: "callback" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.callbackOf).toBe(ORIG_JID);
    expect(r.value.props.callbackReason).toBe("callback");
    expect(repo.saved).toBeDefined();
    expect(repo.saved?.props.callbackOf).toBe(ORIG_JID);
    // event bus must receive a job.updated event
    const emitted = bus.recorded.filter((e) => e.name === "job.updated");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.payload.jobId).toBe(JID as string);
  });

  it("missing original → notFound (no save)", async () => {
    const job = makeJob(JID);
    const repo = new FakeRepo([job]); // no original
    const uc = new ConfirmCallbackUseCase(repo, new InMemoryEventBus(), clock);
    const r = await uc.exec({ jobId: JID, originalJobId: ORIG_JID, reason: "callback" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
    expect(repo.saved).toBeUndefined();
  });

  it("self-reference (originalJobId === jobId) → validation err", async () => {
    const job = makeJob(JID);
    const repo = new FakeRepo([job]);
    const uc = new ConfirmCallbackUseCase(repo, new InMemoryEventBus(), clock);
    const r = await uc.exec({ jobId: JID, originalJobId: JID, reason: "callback" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
  });
});
