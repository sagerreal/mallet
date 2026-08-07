/**
 * RecordChangeOrderUseCase — the signed addendum behind the found-work approval.
 *
 * The invariant under test: approving found work produces a REAL signed estimate that points at
 * the running job (`changeOrderForJobId`), carries the customer's name, mark and a frozen
 * snapshot, and mints a NEW document every time (never collapsing three separate approvals into
 * one). Those four properties are what make the invoicing module's overage check able to tell
 * signed extra work from work nobody agreed to.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  FixedClock,
  isOk,
  type OrgId,
  type EstimateId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import type { Estimate } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { AiDraftSnapshot } from "../domain/edit-delta";
import { RecordChangeOrderUseCase, type RecordChangeOrderCommand } from "./record-change-order";

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

  async nextNumber(): Promise<string> {
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

const command = (overrides: Partial<RecordChangeOrderCommand> = {}): RecordChangeOrderCommand => ({
  orgId: ORG,
  leadId: LEAD,
  jobId: JOB_ID,
  jobTitle: "Water heater swap",
  lines: [{ description: "Expansion tank", quantity: 1, rateCents: 24_000, costCents: 9_000 }],
  signerName: "Dave Chen",
  signatureSvg: "M10,10 L40,30",
  orgName: "E2E Plumbing",
  ...overrides,
});

describe("RecordChangeOrderUseCase", () => {
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let useCase: RecordChangeOrderUseCase;

  beforeEach(() => {
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    useCase = new RecordChangeOrderUseCase(repo, bus, new FixedClock(NOW), seqIds());
  });

  it("points the addendum at the running job — the pointer the overage check reads", async () => {
    const r = await useCase.exec(command());
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.changeOrderForJobId).toBe(JOB_ID);
  });

  it("is born accepted, field-origin and SIGNED — never an unsigned addendum", async () => {
    const r = await useCase.exec(command());
    if (!isOk(r)) throw new Error("expected ok");
    expect(r.value.props.status).toBe("accepted");
    expect(r.value.origin()).toBe("field");
    expect(r.value.props.signerName).toBe("Dave Chen");
    expect(r.value.props.signedAt).toEqual(NOW);
  });

  it("freezes a snapshot whose total is what the customer saw", async () => {
    const r = await useCase.exec(
      command({
        lines: [
          { description: "Expansion tank", quantity: 1, rateCents: 24_000, costCents: 9_000 },
          { description: "Shutoff valve", quantity: 2, rateCents: 6_500, costCents: 2_000 },
        ],
      }),
    );
    if (!isOk(r)) throw new Error("expected ok");
    expect(r.value.props.signedSnapshot?.totalCents).toBe(24_000 + 2 * 6_500);
    expect(r.value.total()).toBe(37_000);
  });

  it("names the shop in the authorisation sentence from the caller's DB read", async () => {
    const r = await useCase.exec(command());
    if (!isOk(r)) throw new Error("expected ok");
    expect(r.value.props.signedSnapshot?.authorizationText).toContain("E2E Plumbing");
  });

  it("mints a SEPARATE document per approval — three trips back to the van, three addenda", async () => {
    const first = await useCase.exec(command());
    const second = await useCase.exec(
      command({ lines: [{ description: "Pan", quantity: 1, rateCents: 4_000, costCents: 0 }] }),
    );
    if (!isOk(first) || !isOk(second)) throw new Error("expected ok");
    expect(second.value.props.id).not.toBe(first.value.props.id);
    expect(repo.store.size).toBe(2);
  });

  it("titles the addendum with the job it belongs to, and stands alone when the job has none", async () => {
    const titled = await useCase.exec(command());
    const untitled = await useCase.exec(command({ jobTitle: null }));
    if (!isOk(titled) || !isOk(untitled)) throw new Error("expected ok");
    expect(titled.value.props.title).toBe("Found work — Water heater swap");
    expect(untitled.value.props.title).toBe("Found work");
  });

  it("announces the acceptance so the addendum counts as won work", async () => {
    await useCase.exec(command());
    const accepted = bus.recorded.filter((e) => e.name === "estimate.accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.payload).toMatchObject({ leadId: LEAD, totalCents: 24_000 });
  });

  it("refuses an empty addendum — a signature must refer to something", async () => {
    const r = await useCase.exec(command({ lines: [] }));
    expect(isOk(r)).toBe(false);
    expect(repo.store.size).toBe(0);
  });

  it("refuses a blank signer and writes nothing", async () => {
    const r = await useCase.exec(command({ signerName: "   " }));
    expect(isOk(r)).toBe(false);
    expect(repo.store.size).toBe(0);
  });
});
