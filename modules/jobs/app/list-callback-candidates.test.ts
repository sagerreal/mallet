import { describe, it, expect } from "vitest";
import { asOrgId, asJobId, asLeadId, FixedClock, isOk, zeroMoney } from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job } from "../domain/job";
import type { JobRepository, CallbackScanRow } from "../domain/job-repository";
import { ListCallbackCandidatesUseCase } from "./list-callback-candidates";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD_A = asLeadId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const JID_ORIG = asJobId("11111111-1111-1111-1111-111111111111");
const JID_NEW = asJobId("33333333-3333-3333-3333-333333333333");
const JID_UNRELATED = asJobId("44444444-4444-4444-4444-444444444444");
const JID_CONFIRMED = asJobId("55555555-5555-5555-5555-555555555555");

const NOW = new Date("2026-07-15T00:00:00Z");
const COMPLETED_20_DAYS_AGO = new Date(NOW.getTime() - 20 * 86400000);
const CREATED_10_DAYS_AGO = new Date(NOW.getTime() - 10 * 86400000);

function makeRow(overrides: Partial<CallbackScanRow>): CallbackScanRow {
  return {
    id: JID_ORIG,
    num: "JOB-1",
    leadId: LEAD_A as string,
    svc: "drain cleaning",
    status: "complete",
    completedAt: COMPLETED_20_DAYS_AGO,
    scheduledStart: null,
    createdAt: new Date("2026-06-01T00:00:00Z"),
    callbackOf: null,
    callbackReason: null,
    ...overrides,
  };
}

class FakeRepo implements JobRepository {
  constructor(private scanRows: CallbackScanRow[] = []) {}
  async listRecentForCallbackScan() { return this.scanRows; }
  async nextNumber() { return "JOB-1"; }
  async save() {}
  async insertManual() {}
  async archiveByLead(): Promise<number> { return 0; }
  async archive() { return 1; }
  // Convert-on-accept (create-job-from-estimate) — not exercised by this suite.
  async adoptEstimateOnJob(): Promise<boolean> { return false; }
  async insertForEstimate() { return true; }
  async findById() { return null; }
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
  async viewCounts(): Promise<{ counts: Record<string, number>; todayCents: number }> { return { counts: {}, todayCents: 0 } as never; }
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
  async listConfirmedCallbacksWithOriginals() { return []; }
}

describe("ListCallbackCandidatesUseCase", () => {
  it("returns a candidate when same-customer + same-service pair exists", async () => {
    const origRow = makeRow({
      id: JID_ORIG,
      num: "JOB-100",
      leadId: LEAD_A as string,
      svc: "drain cleaning",
      status: "complete",
      completedAt: COMPLETED_20_DAYS_AGO,
      createdAt: new Date("2026-06-01T00:00:00Z"),
      callbackOf: null,
      callbackReason: null,
    });
    const newRow = makeRow({
      id: JID_NEW,
      num: "JOB-200",
      leadId: LEAD_A as string,
      svc: "drain cleaning",
      status: "scheduled",
      completedAt: null,
      scheduledStart: null,
      createdAt: CREATED_10_DAYS_AGO,
      callbackOf: null,
      callbackReason: null,
    });
    const repo = new FakeRepo([origRow, newRow]);
    const clock = new FixedClock(NOW);
    const uc = new ListCallbackCandidatesUseCase(repo, clock);
    const result = await uc.exec();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.jobId).toBe(JID_NEW as string);
    expect(result.value[0]!.jobNum).toBe("JOB-200");
    expect(result.value[0]!.original.jobId).toBe(JID_ORIG as string);
    expect(result.value[0]!.original.num).toBe("JOB-100");
  });

  it("filters out a job with callbackReason set (dismissed doesn't resurface)", async () => {
    const origRow = makeRow({
      id: JID_ORIG,
      num: "JOB-100",
      leadId: LEAD_A as string,
      svc: "drain cleaning",
      status: "complete",
      completedAt: COMPLETED_20_DAYS_AGO,
      callbackReason: null,
    });
    const dismissedRow = makeRow({
      id: JID_NEW,
      num: "JOB-200",
      leadId: LEAD_A as string,
      svc: "drain cleaning",
      status: "scheduled",
      completedAt: null,
      createdAt: CREATED_10_DAYS_AGO,
      callbackOf: null,
      // Already dismissed — has a reason
      callbackReason: "new_issue",
    });
    const repo = new FakeRepo([origRow, dismissedRow]);
    const clock = new FixedClock(NOW);
    const uc = new ListCallbackCandidatesUseCase(repo, clock);
    const result = await uc.exec();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(0);
  });

  it("filters out a job with callbackReason='callback' (confirmed doesn't resurface)", async () => {
    const origRow = makeRow({
      id: JID_ORIG,
      num: "JOB-100",
      leadId: LEAD_A as string,
      svc: "drain cleaning",
      status: "complete",
      completedAt: COMPLETED_20_DAYS_AGO,
      callbackReason: null,
    });
    const confirmedRow = makeRow({
      id: JID_CONFIRMED,
      num: "JOB-300",
      leadId: LEAD_A as string,
      svc: "drain cleaning",
      status: "scheduled",
      completedAt: null,
      createdAt: CREATED_10_DAYS_AGO,
      // Already confirmed — callbackOf + reason both set
      callbackOf: JID_ORIG,
      callbackReason: "callback",
    });
    const repo = new FakeRepo([origRow, confirmedRow]);
    const clock = new FixedClock(NOW);
    const uc = new ListCallbackCandidatesUseCase(repo, clock);
    const result = await uc.exec();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(0);
  });

  it("enriches the candidate with the original's num", async () => {
    const origRow = makeRow({
      id: JID_ORIG,
      num: "JOB-ORIG-99",
      svc: "water heater",
      status: "complete",
      completedAt: COMPLETED_20_DAYS_AGO,
      callbackReason: null,
    });
    const newRow = makeRow({
      id: JID_NEW,
      num: "JOB-NEW-11",
      svc: "water heater",
      status: "scheduled",
      completedAt: null,
      createdAt: CREATED_10_DAYS_AGO,
      callbackOf: null,
      callbackReason: null,
    });
    const repo = new FakeRepo([origRow, newRow]);
    const clock = new FixedClock(NOW);
    const uc = new ListCallbackCandidatesUseCase(repo, clock);
    const result = await uc.exec();
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.original.num).toBe("JOB-ORIG-99");
    expect(result.value[0]!.original.svc).toBe("water heater");
  });
});
