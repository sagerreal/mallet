/**
 * Unit tests for ClearEstimateChangeRequestUseCase:
 *
 *  1. not_found — estimate does not exist → error, no event
 *  2. no change request present → validation error (field=changeRequest), no event
 *  3. happy path — clears changeRequestedAt + changeRequest, persists, emits event
 *  4. event payload — orgId, estimateId, leadId correct
 *  5. returns updated Estimate on success
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
import { Estimate } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { AiDraftSnapshot } from "../domain/edit-delta";
import { DraftEstimateUseCase, type EstimateLineInput } from "./draft-estimate";
import { SendEstimateUseCase } from "./send-estimate";
import { RequestEstimateChangeUseCase } from "./request-estimate-change";
import { ClearEstimateChangeRequestUseCase } from "./clear-estimate-change-request";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}` };
};

class FakeEstimateRepository implements EstimateRepository {
  // AI-draft snapshot (write-once, mirrors the Drizzle repo's IS NULL guard).
  private readonly aiDrafts = new Map<string, AiDraftSnapshot>();
  async setAiDraft(id: EstimateId, snapshot: AiDraftSnapshot): Promise<void> {
    if (!this.aiDrafts.has(id)) this.aiDrafts.set(id, snapshot);
  }
  async getAiDraft(id: EstimateId): Promise<AiDraftSnapshot | null> {
    return this.aiDrafts.get(id) ?? null;
  }

  private readonly store = new Map<EstimateId, Estimate>();
  private readonly archived = new Set<EstimateId>();
  private seq = 1000;

  async nextNumber(): Promise<string> { return `EST-${this.seq++}`; }
  async save(e: Estimate): Promise<void> { this.store.set(e.props.id, e); }
  async findById(id: EstimateId): Promise<Estimate | null> {
    if (this.archived.has(id)) return null;
    return this.store.get(id) ?? null;
  }
  async list(_p: CursorPage, _f?: EstimateFilter): Promise<Paginated<Estimate>> {
    return { items: [...this.store.values()], nextCursor: null };
  }
  async listByLead(_l: LeadId, p: CursorPage): Promise<Paginated<Estimate>> { return this.list(p); }
  async archive(id: EstimateId, _n: Date): Promise<number> {
    if (this.archived.has(id) || !this.store.has(id)) return 0;
    this.archived.add(id); return 1;
  }
  async restore(id: EstimateId, _n: Date): Promise<Estimate | null> {
    if (!this.archived.has(id)) return null;
    this.archived.delete(id); return this.store.get(id) ?? null;
  }
  async archiveByLead(leadId: LeadId, _n: Date): Promise<number> {
    let count = 0;
    for (const [id, e] of this.store) {
      if (e.props.leadId === leadId && !this.archived.has(id)) { this.archived.add(id); count++; }
    }
    return count;
  }
}

const oneLine = (): EstimateLineInput => ({
  description: "Labor", quantity: 1, rateCents: 100_000, costCents: 0, isOptional: false, needsPhoto: false,
});

const T0 = new Date("2026-07-11T10:00:00Z");
const T1 = new Date("2026-07-11T11:00:00Z");

async function seedSentEstimateWithChangeRequest(
  repo: FakeEstimateRepository,
): Promise<EstimateId> {
  const clock = new FixedClock(T0);
  const bus = new InMemoryEventBus();
  const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  const r = await draft.exec({
    orgId: ORG, leadId: LEAD, title: null, discBps: 0, taxBps: 0, depBps: 0, validDays: null,
    lines: [oneLine()],
  });
  if (!isOk(r)) throw new Error(`draft failed: ${r.error.message}`);
  const sent = await new SendEstimateUseCase(repo, bus, clock).exec({ estimateId: r.value.props.id });
  if (!isOk(sent)) throw new Error(`send failed: ${sent.error.message}`);
  // Submit a change request (using T_EARLY so the 10-min cooldown doesn't block it)
  const changed = await new RequestEstimateChangeUseCase(repo, bus, clock).exec({
    estimateId: sent.value.props.id,
    message: "please lower the price",
  });
  if (!isOk(changed)) throw new Error(`requestChange failed: ${changed.error.message}`);
  return changed.value.props.id;
}

async function seedSentEstimateNoChangeRequest(
  repo: FakeEstimateRepository,
): Promise<EstimateId> {
  const clock = new FixedClock(T0);
  const bus = new InMemoryEventBus();
  const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  const r = await draft.exec({
    orgId: ORG, leadId: LEAD, title: null, discBps: 0, taxBps: 0, depBps: 0, validDays: null,
    lines: [oneLine()],
  });
  if (!isOk(r)) throw new Error(`draft failed: ${r.error.message}`);
  const sent = await new SendEstimateUseCase(repo, bus, clock).exec({ estimateId: r.value.props.id });
  if (!isOk(sent)) throw new Error(`send failed: ${sent.error.message}`);
  return sent.value.props.id;
}

describe("ClearEstimateChangeRequestUseCase — not_found", () => {
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    clock = new FixedClock(T1);
  });

  it("returns not_found when estimate does not exist", async () => {
    const uc = new ClearEstimateChangeRequestUseCase(repo, bus, clock);
    const r = await uc.exec({ estimateId: asEstimateId("99999999-9999-9999-9999-999999999999") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("does NOT emit any event when not found", async () => {
    const uc = new ClearEstimateChangeRequestUseCase(repo, bus, clock);
    await uc.exec({ estimateId: asEstimateId("99999999-9999-9999-9999-999999999999") });
    expect(bus.recorded).toHaveLength(0);
  });
});

describe("ClearEstimateChangeRequestUseCase — domain rejection (no change request)", () => {
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    clock = new FixedClock(T1);
  });

  it("returns validation error when no change request is present", async () => {
    const id = await seedSentEstimateNoChangeRequest(repo);
    const freshBus = new InMemoryEventBus();
    const uc = new ClearEstimateChangeRequestUseCase(repo, freshBus, clock);
    const r = await uc.exec({ estimateId: id });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      if (r.error.kind === "validation") {
        expect(r.error.field).toBe("changeRequest");
      }
    }
  });

  it("does NOT emit any event when domain rejects", async () => {
    const id = await seedSentEstimateNoChangeRequest(repo);
    const freshBus = new InMemoryEventBus();
    const uc = new ClearEstimateChangeRequestUseCase(repo, freshBus, clock);
    await uc.exec({ estimateId: id });
    expect(freshBus.recorded).toHaveLength(0);
  });
});

describe("ClearEstimateChangeRequestUseCase — happy path", () => {
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    clock = new FixedClock(T1);
  });

  it("clears changeRequestedAt and changeRequest on the persisted estimate", async () => {
    const id = await seedSentEstimateWithChangeRequest(repo);
    const freshBus = new InMemoryEventBus();
    await new ClearEstimateChangeRequestUseCase(repo, freshBus, clock).exec({ estimateId: id });
    const persisted = await repo.findById(id);
    expect(persisted?.props.changeRequestedAt).toBeNull();
    expect(persisted?.props.changeRequest).toBeNull();
  });

  it("emits exactly one estimate.change_request_cleared event with correct payload", async () => {
    const id = await seedSentEstimateWithChangeRequest(repo);
    const freshBus = new InMemoryEventBus();
    await new ClearEstimateChangeRequestUseCase(repo, freshBus, clock).exec({ estimateId: id });
    const events = freshBus.recorded.filter((e) => e.name === "estimate.change_request_cleared");
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev?.orgId).toBe(ORG);
    expect(ev?.payload).toMatchObject({ estimateId: id, leadId: LEAD });
  });

  it("returns the cleared Estimate on success", async () => {
    const id = await seedSentEstimateWithChangeRequest(repo);
    const r = await new ClearEstimateChangeRequestUseCase(repo, bus, clock).exec({ estimateId: id });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.changeRequestedAt).toBeNull();
    expect(r.value.props.changeRequest).toBeNull();
    expect(r.value.props.status).toBe("sent"); // status unchanged
  });
});
