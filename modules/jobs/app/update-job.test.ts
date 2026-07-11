import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asJobId, asLeadId, FixedClock, isOk, zeroMoney } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { UpdateJobUseCase } from "./update-job";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JID = asJobId("11111111-1111-1111-1111-111111111111");

function makeJob() {
  const r = Job.create({
    id: JID, orgId: ORG, num: "JOB-1", leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    sourceEstimateId: null, assigneeUserId: null, title: "Old", svc: "service", status: "scheduled",
    scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null, canceledAt: null,
    cancelReason: null, total: zeroMoney, notes: null, visits: [],
    createdAt: new Date("2026-07-10T00:00:00Z"), updatedAt: new Date("2026-07-10T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error("setup"); return r.value;
}

class FakeRepo implements JobRepository {
  constructor(private job: Job | null) {}
  saved?: Job;
  async nextNumber() { return "JOB-1"; }
  async save(j: Job) { this.saved = j; this.job = j; }
  async insertManual(j: Job) { this.saved = j; }
  async archive() { return 1; }
  async insertForEstimate() { return true; }
  async findById() { return this.job; }
  async findBySourceEstimate() { return null; }
  async list() { return { items: [], nextCursor: null }; }
  async listByLead() { return { items: [], nextCursor: null }; }
}

describe("UpdateJobUseCase", () => {
  let clock: FixedClock;
  beforeEach(() => { clock = new FixedClock(new Date("2026-07-10T13:00:00Z")); });

  it("patches title/svc/notes and saves", async () => {
    const repo = new FakeRepo(makeJob());
    const uc = new UpdateJobUseCase(repo, new InMemoryEventBus(), clock);
    const r = await uc.exec({ jobId: JID, title: "New", svc: "estimate", notes: "code 4" });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.title).toBe("New");
      expect(r.value.props.svc).toBe("estimate");
      expect(r.value.props.notes).toBe("code 4");
    }
    expect(repo.saved).toBeDefined();
  });

  it("returns NOT_FOUND when the job is missing", async () => {
    const repo = new FakeRepo(null);
    const uc = new UpdateJobUseCase(repo, new InMemoryEventBus(), clock);
    const r = await uc.exec({ jobId: JID, title: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});
