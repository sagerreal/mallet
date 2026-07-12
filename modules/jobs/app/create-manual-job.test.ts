import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asLeadId, asJobId, FixedClock, isOk, type OrgId, type LeadId } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { CreateManualJobUseCase } from "./create-manual-job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const MINTED = "44444444-4444-4444-4444-444444444444";

class FakeRepo implements JobRepository {
  saved?: Job;
  numCalls = 0;
  async nextNumber() { this.numCalls++; return "JOB-1000"; }
  async save(j: Job) { this.saved = j; }
  async insertManual(j: Job) { this.saved = j; }
  async archive() { return 1; }
  async insertForEstimate() { return true; }
  async findById() { return null; }
  async findBySourceEstimate() { return null; }
  async list() { return { items: [], nextCursor: null }; }
  async listByLead() { return { items: [], nextCursor: null }; }
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

const ids = (id = MINTED) => ({ newId: () => id });

describe("CreateManualJobUseCase", () => {
  let clock: FixedClock;
  let repo: FakeRepo;
  let useCase: CreateManualJobUseCase;
  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
    repo = new FakeRepo();
    useCase = new CreateManualJobUseCase(repo, new InMemoryEventBus(), clock, ids());
  });

  it("creates an unscheduled job for a lead with svc + minted num", async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, title: "Water heater", svc: "service", addr: "1 Main St", phone: "555", notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.leadId).toBe(LEAD);
      expect(r.value.props.svc).toBe("service");
      expect(r.value.props.num).toBe("JOB-1000");
      expect(r.value.props.status).toBe("scheduled");
      expect(r.value.props.sourceEstimateId).toBeNull();
    }
    expect(repo.saved).toBeDefined();
  });

  it("uses the caller-provided id when present", async () => {
    const r = await useCase.exec({ id: "55555555-5555-5555-5555-555555555555", orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.id).toBe("55555555-5555-5555-5555-555555555555");
  });

  it("mints an id when none is provided", async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null });
    if (isOk(r)) expect(r.value.props.id).toBe(MINTED);
  });
});
