import { describe, it, expect, beforeEach } from "vitest";
import { asOrgId, asLeadId, asJobId, FixedClock, isOk, isErr, type OrgId, type LeadId, type JobId } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { CreateManualJobUseCase } from "./create-manual-job";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";
import type { JobLine } from "../domain/job-execution";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const MINTED = "44444444-4444-4444-4444-444444444444";

class FakeRepo implements JobRepository {
  saved?: Job;
  numCalls = 0;
  replaced?: { jobId: JobId; lines: readonly JobLine[]; now: Date };
  async nextNumber() { this.numCalls++; return "JOB-1000"; }
  async save(j: Job) { this.saved = j; }
  async insertManual(j: Job) { this.saved = j; }
  async archiveByLead(): Promise<number> { return 0; }
  async archive() { return 1; }
  // Convert-on-accept (create-job-from-estimate) — not exercised by this suite.
  async adoptEstimateOnJob(): Promise<boolean> { return false; }
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
  async replaceLines(jobId: JobId, lines: readonly JobLine[], now: Date) { this.replaced = { jobId, lines, now }; }
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

  it('defaults kind to "work" when the command omits it', async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.kind).toBe("work");
  });

  it("passes an explicit kind through to the job", async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, kind: "estimate", title: null, svc: null, addr: null, phone: null, notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.kind).toBe("estimate");
  });

  it("passes an explicit scope through to the job props", async () => {
    const r = await useCase.exec({
      orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null,
      scope: "unit is about 12 years old",
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.scope).toBe("unit is about 12 years old");
  });

  it("defaults scope to null when the command omits it", async () => {
    const r = await useCase.exec({ orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.scope).toBeNull();
  });

  // ── booked flat price → priced lines on the job (three-flows money, task 3) ──

  const BASE = { orgId: ORG, leadId: LEAD, title: null, svc: null, addr: null, phone: null, notes: null } as const;

  it("one priced line: replaceLines is called with rate 9900 and the job total is 9900", async () => {
    const r = await useCase.exec({
      ...BASE,
      lines: [{ description: "Drain cleaning", quantity: 1, rateCents: 9900 }],
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.total).toBe(9900);
    expect(repo.replaced).toBeDefined();
    expect(repo.replaced!.jobId).toBe(asJobId(MINTED));
    expect(repo.replaced!.lines).toHaveLength(1);
    const line = repo.replaced!.lines[0]!.props;
    expect(line.description).toBe("Drain cleaning");
    expect(line.quantity).toBe(1);
    expect(line.rate).toBe(9900);
    expect(line.cost).toBe(0);
    expect(line.position).toBe(1);
  });

  it("no lines: total stays zero and replaceLines is never called (today's behavior)", async () => {
    const r = await useCase.exec({ ...BASE });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.total).toBe(0);
    expect(repo.replaced).toBeUndefined();
    expect(repo.saved).toBeDefined();
  });

  it("an empty lines array behaves exactly like no lines", async () => {
    const r = await useCase.exec({ ...BASE, lines: [] });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.total).toBe(0);
    expect(repo.replaced).toBeUndefined();
  });

  it("sums multiple lines with per-line quantity×rate rounding", async () => {
    const r = await useCase.exec({
      ...BASE,
      lines: [
        { description: "Drain cleaning", quantity: 1, rateCents: 9900 },
        { description: "Extra footage", quantity: 2, rateCents: 2500, costCents: 1000 },
      ],
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.total).toBe(14900);
    expect(repo.replaced!.lines).toHaveLength(2);
    expect(repo.replaced!.lines[1]!.props.cost).toBe(1000);
    expect(repo.replaced!.lines[1]!.props.position).toBe(2);
  });

  it("rejects more than 200 lines with a validation error and writes nothing", async () => {
    const lines = Array.from({ length: 201 }, (_, i) => ({
      description: `Line ${i}`, quantity: 1, rateCents: 100,
    }));
    const r = await useCase.exec({ ...BASE, lines });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
    expect(repo.replaced).toBeUndefined();
  });

  it("rejects a non-integer rateCents (validation), nothing written", async () => {
    const r = await useCase.exec({ ...BASE, lines: [{ description: "Drain", quantity: 1, rateCents: 99.5 }] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
  });

  it("rejects a non-integer costCents (validation), nothing written", async () => {
    const r = await useCase.exec({ ...BASE, lines: [{ description: "Drain", quantity: 1, rateCents: 9900, costCents: 10.1 }] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
  });

  it("rejects a negative quantity (validation), nothing written", async () => {
    const r = await useCase.exec({ ...BASE, lines: [{ description: "Drain", quantity: -1, rateCents: 9900 }] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
  });

  it("rejects a negative rateCents (validation), nothing written", async () => {
    const r = await useCase.exec({ ...BASE, lines: [{ description: "Drain", quantity: 1, rateCents: -100 }] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
  });

  it("rejects an empty line description (validation), nothing written", async () => {
    const r = await useCase.exec({ ...BASE, lines: [{ description: "   ", quantity: 1, rateCents: 9900 }] });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
    expect(repo.replaced).toBeUndefined();
  });

  // The estimate invariant, enforced in the DOMAIN — not by caller discipline: a kind='estimate'
  // create must NEVER carry priced lines, no matter which caller (router, voice tool, a future
  // server-side flow) combines the two.

  it("rejects kind='estimate' + priced lines (estimates never carry money at create)", async () => {
    const r = await useCase.exec({
      ...BASE,
      kind: "estimate",
      lines: [{ description: "x", quantity: 1, rateCents: 50_000 }],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
    expect(repo.replaced).toBeUndefined();
  });

  it("rejects the stale-bundle svc='estimate' shape + priced lines (guard runs on the NORMALIZED kind)", async () => {
    // A pre-0133 bundle encodes "estimate visit" as svc='estimate' with no kind. normalizeSvcKind
    // turns that into kind='estimate' — the money guard must fire on that normalized kind too.
    const r = await useCase.exec({
      ...BASE,
      svc: "estimate",
      lines: [{ description: "x", quantity: 1, rateCents: 50_000 }],
    });
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.kind).toBe("validation");
    expect(repo.saved).toBeUndefined();
    expect(repo.replaced).toBeUndefined();
  });

  it("kind='estimate' with NO lines still creates normally (the guard only blocks money)", async () => {
    const r = await useCase.exec({ ...BASE, kind: "estimate", lines: [] });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.props.kind).toBe("estimate");
      expect(r.value.props.total).toBe(0);
    }
    expect(repo.replaced).toBeUndefined();
  });
});
