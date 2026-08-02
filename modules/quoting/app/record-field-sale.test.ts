/**
 * RecordFieldSaleUseCase — the record behind v1.field.signQuote.
 *
 * The invariant under test: a quote sold in the field becomes a REAL accepted estimate exactly
 * once per job — created on the first sign, UPDATED (never duplicated) on a re-sign, left alone
 * when the job was already sold from an office quote, and failed loudly when the job's linkage
 * is corrupt.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  FixedClock,
  isOk,
  type OrgId,
  type EstimateId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Estimate, EstimateLine } from "../domain/estimate";
import { money, zeroMoney, asEstimateLineId } from "@mallet/shared/types";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { AiDraftSnapshot } from "../domain/edit-delta";
import { RecordFieldSaleUseCase, type RecordFieldSaleCommand } from "./record-field-sale";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB_ID = "44444444-4444-4444-4444-444444444444";
const NOW = new Date("2026-08-01T15:00:00Z");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

class FakeEstimateRepository implements EstimateRepository {
  private readonly aiDrafts = new Map<string, AiDraftSnapshot>();
  async setAiDraft(id: EstimateId, snapshot: AiDraftSnapshot): Promise<void> {
    if (!this.aiDrafts.has(id)) this.aiDrafts.set(id, snapshot);
  }
  async getAiDraft(id: EstimateId): Promise<AiDraftSnapshot | null> {
    return this.aiDrafts.get(id) ?? null;
  }

  readonly store = new Map<EstimateId, Estimate>();
  private seq = 1000;
  nextNumberCalls = 0;

  async nextNumber(): Promise<string> {
    this.nextNumberCalls += 1;
    const value = this.seq;
    this.seq += 1;
    return `EST-${value}`;
  }

  async save(estimate: Estimate): Promise<void> {
    this.store.set(estimate.props.id, estimate);
  }

  async findById(id: EstimateId): Promise<Estimate | null> {
    return this.store.get(id) ?? null;
  }

  async list(_page: CursorPage, _filter?: EstimateFilter): Promise<Paginated<Estimate>> {
    return { items: [...this.store.values()], nextCursor: null };
  }

  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Estimate>> {
    return this.list(page);
  }

  async archive(_id: EstimateId, _now: Date): Promise<number> {
    return 0;
  }

  async restore(_id: EstimateId, _now: Date): Promise<Estimate | null> {
    return null;
  }

  async archiveByLead(_leadId: LeadId, _now: Date): Promise<number> {
    return 0;
  }
}

const command = (overrides: Partial<RecordFieldSaleCommand> = {}): RecordFieldSaleCommand => ({
  orgId: ORG,
  leadId: LEAD,
  jobId: JOB_ID,
  jobTitle: "Water heater swap",
  existingEstimateId: null,
  lines: [
    { description: "Water heater swap", quantity: 1, rateCents: 150_000, costCents: 0 },
    { description: "Haul-away", quantity: 1, rateCents: 5_000, costCents: 0 },
  ],
  signerName: "Dave Chen",
  signatureSvg: "M10,10 L40,30",
  orgName: "E2E Plumbing",
  ...overrides,
});

describe("RecordFieldSaleUseCase", () => {
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let useCase: RecordFieldSaleUseCase;

  beforeEach(() => {
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    useCase = new RecordFieldSaleUseCase(repo, bus, new FixedClock(NOW), seqIds());
  });

  it("creates an ACCEPTED field-origin estimate carrying the signed lines and evidence", async () => {
    const result = await useCase.exec(command());
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.kind).toBe("created");

    const est = result.value.estimate;
    expect(est.props.status).toBe("accepted");
    expect(est.origin()).toBe("field");
    expect(est.props.orgId).toBe(ORG);
    expect(est.props.leadId).toBe(LEAD);
    expect(est.props.title).toBe("Water heater swap");
    expect(est.props.num).toBe("EST-1000");
    expect(est.props.acceptedAt).toEqual(NOW);
    // Presenting the tablet IS the presentation — sentAt is stamped so age math reads naturally.
    expect(est.props.sentAt).toEqual(NOW);
    expect(est.props.lines).toHaveLength(2);
    expect(est.total()).toBe(155_000);
    // The evidence: signer, mark, and a frozen snapshot of exactly what was signed.
    expect(est.props.signerName).toBe("Dave Chen");
    expect(est.props.signatureSvg).toBe("M10,10 L40,30");
    expect(est.props.signedAt).toEqual(NOW);
    expect(est.props.signedSnapshot?.totalCents).toBe(155_000);
    expect(est.props.signedSnapshot?.authorizationText).toMatch(/E2E Plumbing/);
    // Persisted, and announced the same way an office accept is.
    expect(repo.store.get(est.props.id)).toBe(est);
    expect(bus.recorded.map((e) => e.name)).toContain("estimate.accepted");
  });

  it("a RE-SIGN updates the job's existing field estimate — never a duplicate", async () => {
    const first = await useCase.exec(command());
    if (!isOk(first)) throw new Error("first sign failed");
    const firstId = first.value.estimate.props.id;

    const second = await useCase.exec(
      command({
        existingEstimateId: firstId,
        lines: [{ description: "Water heater swap + expansion tank", quantity: 1, rateCents: 180_000, costCents: 0 }],
        signerName: "Dave Chen Jr",
      }),
    );
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.kind).toBe("updated");
    // Same estimate, replaced content — whatever was signed last is the quote.
    expect(second.value.estimate.props.id).toBe(firstId);
    expect(second.value.estimate.props.lines).toHaveLength(1);
    expect(second.value.estimate.total()).toBe(180_000);
    expect(second.value.estimate.props.signerName).toBe("Dave Chen Jr");
    expect(second.value.estimate.origin()).toBe("field");
    expect(repo.store.size).toBe(1);
    // No second number burned on a re-sign.
    expect(repo.nextNumberCalls).toBe(1);
  });

  it("keeps an OFFICE-born source estimate untouched — its signed document is frozen", async () => {
    const officeLine = EstimateLine.create({
      id: asEstimateLineId("55555555-5555-5555-5555-555555555555"),
      description: "Original office scope",
      quantity: 1,
      rate: money(90_000),
      cost: money(0),
      isOptional: false,
      needsPhoto: false,
      position: 0,
      tier: null,
      materialId: null,
    });
    if (!officeLine.ok) throw new Error("line build failed");
    const office = Estimate.create({
      id: asEstimateId("66666666-6666-6666-6666-666666666666"),
      orgId: ORG,
      num: "EST-1",
      leadId: LEAD,
      title: null,
      status: "accepted",
      discBps: 0,
      taxBps: 0,
      depBps: 0,
      depPaid: zeroMoney,
      validDays: null,
      sentAt: NOW,
      acceptedAt: NOW,
      declinedAt: null,
      declineReason: null,
      changeRequestedAt: null,
      changeRequest: null,
      changeOrderForJobId: null,
      publicToken: null,
      recommendedTier: null,
      acceptedTier: null,
      tierNames: null,
      termsSnapshot: null,
      lines: [officeLine.value],
      createdAt: NOW,
      updatedAt: NOW,
    });
    if (!office.ok) throw new Error("office estimate build failed");
    await repo.save(office.value);

    const result = await useCase.exec(command({ existingEstimateId: office.value.props.id }));
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.kind).toBe("kept_office_estimate");
    // Nothing written: same single estimate, same content, no number allocated.
    expect(repo.store.size).toBe(1);
    expect(repo.store.get(office.value.props.id)?.total()).toBe(90_000);
    expect(repo.nextNumberCalls).toBe(0);
  });

  it("fails LOUDLY when the job's source estimate no longer exists (corrupt linkage)", async () => {
    const result = await useCase.exec(
      command({ existingEstimateId: "99999999-9999-9999-9999-999999999999" }),
    );
    expect(isOk(result)).toBe(false);
    if (isOk(result)) return;
    expect(result.error.kind).toBe("not_found");
    expect(repo.store.size).toBe(0);
  });

  it("rejects a blank signer name and writes nothing", async () => {
    const result = await useCase.exec(command({ signerName: "   " }));
    expect(isOk(result)).toBe(false);
    expect(repo.store.size).toBe(0);
    expect(bus.recorded).toHaveLength(0);
  });

  it("rejects an invalid line and writes nothing", async () => {
    const result = await useCase.exec(
      command({ lines: [{ description: "", quantity: 1, rateCents: 100, costCents: 0 }] }),
    );
    expect(isOk(result)).toBe(false);
    expect(repo.store.size).toBe(0);
  });
});
