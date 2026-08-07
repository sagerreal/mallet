/**
 * ApproveFoundWorkUseCase — the customer signs for found work and the found work starts billing.
 *
 * The invariants under test are the two states that must never exist: the customer having signed
 * for work the job does not carry, and the job carrying work nobody signed for. Everything here
 * is one of those two, plus the partial-approval refusal that keeps a silent under-bill from
 * looking like a success.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  asJobId,
  asOrgId,
  FixedClock,
  isOk,
  isErr,
  ok,
  err,
  conflict,
  type JobId,
  type Result,
  type AppError,
} from "@mallet/shared/types";
import { JobLine, JobAddon, type JobVerifyAnswer, type JobPhoto } from "../domain/job-execution";
import type { JobRepository } from "../domain/job-repository";
import type { Job } from "../domain/job";
import type {
  ChangeOrderRecorder,
  ChangeOrderRequest,
  RecordedChangeOrder,
} from "../domain/change-order-recorder";
import { ApproveFoundWorkUseCase, type ApproveFoundWorkCommand } from "./approve-found-work";

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const JOB: JobId = asJobId("11111111-1111-1111-1111-111111111111");
const MISSING: JobId = asJobId("99999999-9999-9999-9999-999999999999");
const LEAD = "33333333-3333-3333-3333-333333333333";
const NOW = new Date("2026-08-01T15:00:00Z");
const ESTIMATE_ID = "55555555-5555-5555-5555-555555555555";

const fakeJob = {
  props: { id: JOB, leadId: LEAD, title: "Water heater swap" },
} as unknown as Job;

const addon = (id: string, description: string, rateCents: number, status = "proposed"): JobAddon => {
  const r = JobAddon.create({
    id,
    jobId: JOB,
    description,
    quantity: 1,
    rateCents,
    costCents: 0,
    isOptional: false,
    invoiceSkip: false,
    status,
    position: 0,
  });
  if (!r.ok) throw new Error("bad fixture");
  return r.value;
};

const line = (id: string, description: string, rateCents: number, position: number): JobLine => {
  const r = JobLine.create({ id, jobId: JOB, description, quantity: 1, rateCents, costCents: 0, position });
  if (!r.ok) throw new Error("bad fixture");
  return r.value;
};

class FakeRepo implements Partial<JobRepository> {
  jobs = new Map<string, Job>([[JOB, fakeJob]]);
  lines: JobLine[] = [];
  addons: JobAddon[] = [];
  /** Set to drop specific ids from what approveAddons reports moving — the partial-approval race. */
  refuseToMove = new Set<string>();
  approvalCalls: { ids: readonly string[]; estimateId: string }[] = [];

  async findById(id: JobId): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }
  async listExecution(): Promise<{
    lines: JobLine[];
    addons: JobAddon[];
    verifyAnswers: JobVerifyAnswer[];
    photos: JobPhoto[];
  }> {
    return { lines: this.lines, addons: this.addons, verifyAnswers: [], photos: [] };
  }
  async addLine(l: JobLine): Promise<void> {
    this.lines = [...this.lines, l];
  }
  async approveAddons(
    _jobId: JobId,
    addonIds: readonly string[],
    approval: { byUserId: string | null; estimateId: string; at: Date },
  ): Promise<string[]> {
    this.approvalCalls = [...this.approvalCalls, { ids: addonIds, estimateId: approval.estimateId }];
    return addonIds.filter(
      (id) =>
        !this.refuseToMove.has(id) &&
        this.addons.some((a) => a.props.id === id && a.props.status === "proposed"),
    );
  }
}

class FakeRecorder implements ChangeOrderRecorder {
  calls: ChangeOrderRequest[] = [];
  failWith: AppError | null = null;

  async record(request: ChangeOrderRequest): Promise<Result<RecordedChangeOrder, AppError>> {
    this.calls = [...this.calls, request];
    if (this.failWith) return err(this.failWith);
    const totalCents = request.lines.reduce((sum, l) => sum + Math.round(l.quantity * l.rateCents), 0);
    return ok({ estimateId: ESTIMATE_ID, totalCents });
  }
}

const seqIds = () => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `aaaaaaaa-aaaa-aaaa-aaaa-${String(n).padStart(12, "0")}`;
    },
  };
};

const command = (overrides: Partial<ApproveFoundWorkCommand> = {}): ApproveFoundWorkCommand => ({
  jobId: JOB,
  addonIds: ["a1"],
  signerName: "Dave Chen",
  signatureSvg: "M10,10 L40,30",
  orgName: "E2E Plumbing",
  approvedByUserId: "44444444-4444-4444-4444-444444444444",
  ...overrides,
});

describe("ApproveFoundWorkUseCase", () => {
  let repo: FakeRepo;
  let recorder: FakeRecorder;
  let useCase: ApproveFoundWorkUseCase;

  beforeEach(() => {
    repo = new FakeRepo();
    recorder = new FakeRecorder();
    useCase = new ApproveFoundWorkUseCase(
      repo as unknown as JobRepository,
      recorder,
      new FixedClock(NOW),
      seqIds(),
    );
    repo.addons = [addon("a1", "Expansion tank", 24_000), addon("a2", "Shutoff valve", 6_500)];
    repo.lines = [line("l1", "Water heater swap", 150_000, 0)];
  });

  it("appends the approved found work to the JOB's lines — the wire to money", async () => {
    const r = await useCase.exec(command(), ORG);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const appended = r.value.execution.lines.find((l) => l.props.description === "Expansion tank");
    expect(appended?.props.rate).toBe(24_000);
    expect(appended?.props.quantity).toBe(1);
  });

  it("preserves the lines the customer already signed for", async () => {
    const r = await useCase.exec(command(), ORG);
    if (!isOk(r)) throw new Error("expected ok");
    expect(r.value.execution.lines.map((l) => l.props.description)).toEqual([
      "Water heater swap",
      "Expansion tank",
    ]);
    expect(r.value.execution.lines[0]?.props.id).toBe("l1");
  });

  it("appends AFTER everything already on the job, so the signed scope keeps its order", async () => {
    repo.lines = [line("l1", "Water heater swap", 150_000, 0), line("l2", "Haul-away", 5_000, 1)];
    const r = await useCase.exec(command({ addonIds: ["a1", "a2"] }), ORG);
    if (!isOk(r)) throw new Error("expected ok");
    expect(r.value.execution.lines.map((l) => l.props.position)).toEqual([0, 1, 2, 3]);
  });

  it("records the signature as a change order on the job's lead, priced from the add-ons", async () => {
    await useCase.exec(command({ addonIds: ["a1", "a2"] }), ORG);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      orgId: ORG,
      leadId: LEAD,
      jobId: JOB,
      jobTitle: "Water heater swap",
      signerName: "Dave Chen",
      orgName: "E2E Plumbing",
    });
    expect(recorder.calls[0]?.lines).toEqual([
      { description: "Expansion tank", quantity: 1, rateCents: 24_000, costCents: 0 },
      { description: "Shutoff valve", quantity: 1, rateCents: 6_500, costCents: 0 },
    ]);
  });

  it("stamps the addendum's id onto the add-on rows it approves", async () => {
    await useCase.exec(command(), ORG);
    expect(repo.approvalCalls).toEqual([{ ids: ["a1"], estimateId: ESTIMATE_ID }]);
  });

  it("REFUSES a partial approval rather than under-billing quietly", async () => {
    repo.refuseToMove.add("a2");
    const r = await useCase.exec(command({ addonIds: ["a1", "a2"] }), ORG);
    expect(isErr(r)).toBe(true);
    if (!isErr(r)) return;
    expect(r.error.kind).toBe(conflict("x").kind);
    // Nothing may reach the job's lines when the approval did not fully land.
    expect(repo.lines.map((l) => l.props.description)).toEqual(["Water heater swap"]);
  });

  it("writes nothing to the job when the signature is refused", async () => {
    recorder.failWith = conflict("signature refused");
    const r = await useCase.exec(command(), ORG);
    expect(isErr(r)).toBe(true);
    expect(repo.approvalCalls).toHaveLength(0);
    expect(repo.lines).toHaveLength(1);
  });

  it("refuses found work that is already settled", async () => {
    repo.addons = [addon("a1", "Expansion tank", 24_000, "approved")];
    const r = await useCase.exec(command(), ORG);
    expect(isErr(r)).toBe(true);
    expect(recorder.calls).toHaveLength(0);
  });

  it("refuses an id that is not on this job", async () => {
    const r = await useCase.exec(command({ addonIds: ["a1", "nope"] }), ORG);
    expect(isErr(r)).toBe(true);
    expect(recorder.calls).toHaveLength(0);
  });

  it("refuses an empty selection and a duplicated one", async () => {
    expect(isErr(await useCase.exec(command({ addonIds: [] }), ORG))).toBe(true);
    expect(isErr(await useCase.exec(command({ addonIds: ["a1", "a1"] }), ORG))).toBe(true);
    expect(recorder.calls).toHaveLength(0);
  });

  it("returns not_found for a job that does not exist", async () => {
    const r = await useCase.exec(command({ jobId: MISSING }), ORG);
    expect(isErr(r)).toBe(true);
    expect(recorder.calls).toHaveLength(0);
  });
});
