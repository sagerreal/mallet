/**
 * Unit tests for RequestEstimateChangeUseCase:
 *
 *  1. not_found — estimate does not exist → error, no event
 *  2. domain error — estimate is not sent (draft) → validation error, no event
 *  3. happy path — sent estimate → changeRequestedAt + changeRequest set, event emitted
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
import { DraftEstimateUseCase, type EstimateLineInput } from "./draft-estimate";
import { SendEstimateUseCase } from "./send-estimate";
import { RequestEstimateChangeUseCase } from "./request-estimate-change";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => `00000000-0000-0000-0000-${String(++n).padStart(12, "0")}` };
};

class FakeEstimateRepository implements EstimateRepository {
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

async function seedSentEstimate(repo: FakeEstimateRepository, bus: InMemoryEventBus, clock: FixedClock): Promise<EstimateId> {
  const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  const r = await draft.exec({ orgId: ORG, leadId: LEAD, title: null, discBps: 0, taxBps: 0, depBps: 0, validDays: null, lines: [oneLine()] });
  if (!isOk(r)) throw new Error(`draft failed: ${r.error.message}`);
  const sent = await new SendEstimateUseCase(repo, bus, clock).exec({ estimateId: r.value.props.id });
  if (!isOk(sent)) throw new Error(`send failed: ${sent.error.message}`);
  return sent.value.props.id;
}

async function seedDraftEstimate(repo: FakeEstimateRepository, bus: InMemoryEventBus, clock: FixedClock): Promise<EstimateId> {
  const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  const r = await draft.exec({ orgId: ORG, leadId: LEAD, title: null, discBps: 0, taxBps: 0, depBps: 0, validDays: null, lines: [oneLine()] });
  if (!isOk(r)) throw new Error(`draft failed: ${r.error.message}`);
  return r.value.props.id;
}

describe("RequestEstimateChangeUseCase — not_found", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-11T10:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("returns not_found when estimate does not exist", async () => {
    const uc = new RequestEstimateChangeUseCase(repo, bus, clock);
    const r = await uc.exec({ estimateId: asEstimateId("99999999-9999-9999-9999-999999999999"), message: "please adjust" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("does NOT emit any event when not found", async () => {
    const uc = new RequestEstimateChangeUseCase(repo, bus, clock);
    await uc.exec({ estimateId: asEstimateId("99999999-9999-9999-9999-999999999999"), message: "please adjust" });
    expect(bus.recorded).toHaveLength(0);
  });
});

describe("RequestEstimateChangeUseCase — domain rejection (draft)", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-11T10:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("returns validation error for a draft estimate", async () => {
    const id = await seedDraftEstimate(repo, bus, clock);
    const freshBus = new InMemoryEventBus();
    const uc = new RequestEstimateChangeUseCase(repo, freshBus, clock);
    const r = await uc.exec({ estimateId: id, message: "please adjust" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("does NOT emit any event when domain rejects", async () => {
    const id = await seedDraftEstimate(repo, bus, clock);
    const freshBus = new InMemoryEventBus();
    const uc = new RequestEstimateChangeUseCase(repo, freshBus, clock);
    await uc.exec({ estimateId: id, message: "please adjust" });
    expect(freshBus.recorded).toHaveLength(0);
  });
});

describe("RequestEstimateChangeUseCase — happy path", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-11T10:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("persists the change request fields on a sent estimate", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    const freshBus = new InMemoryEventBus();
    await new RequestEstimateChangeUseCase(repo, freshBus, clock).exec({ estimateId: id, message: "  add a discount please  " });
    const persisted = await repo.findById(id);
    expect(persisted?.props.changeRequest).toBe("add a discount please");
    expect(persisted?.props.changeRequestedAt).toEqual(clock.now());
  });

  it("emits exactly one estimate.change_requested event with correct payload", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    const freshBus = new InMemoryEventBus();
    await new RequestEstimateChangeUseCase(repo, freshBus, clock).exec({ estimateId: id, message: "lower the price" });
    const events = freshBus.recorded.filter((e) => e.name === "estimate.change_requested");
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev?.orgId).toBe(ORG);
    expect(ev?.payload).toMatchObject({ estimateId: id, leadId: LEAD });
  });

  it("returns the updated Estimate on success", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    const r = await new RequestEstimateChangeUseCase(repo, bus, clock).exec({ estimateId: id, message: "reduce total" });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.changeRequest).toBe("reduce total");
    expect(r.value.props.status).toBe("sent");
  });
});

describe("RequestEstimateChangeUseCase — cooldown", () => {
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("returns validation error with field=cooldown when within 10 minutes of previous request", async () => {
    const t0 = new Date("2026-07-11T10:00:00Z");
    const seedClock = new FixedClock(t0);
    const id = await seedSentEstimate(repo, new InMemoryEventBus(), seedClock);

    // First request succeeds at t0.
    const firstClock = new FixedClock(t0);
    const r1 = await new RequestEstimateChangeUseCase(repo, new InMemoryEventBus(), firstClock).exec({
      estimateId: id,
      message: "please lower price",
    });
    expect(isOk(r1)).toBe(true);

    // Attempt a second request just 5 minutes later — within the 10-minute cooldown.
    const t5min = new Date("2026-07-11T10:05:00Z");
    const secondClock = new FixedClock(t5min);
    const freshBus = new InMemoryEventBus();
    const r2 = await new RequestEstimateChangeUseCase(repo, freshBus, secondClock).exec({
      estimateId: id,
      message: "actually, also remove tax",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.error.kind).toBe("validation");
      if (r2.error.kind === "validation") {
        expect(r2.error.field).toBe("cooldown");
      }
    }
    // No event emitted during cooldown rejection.
    expect(freshBus.recorded).toHaveLength(0);
  });

  it("allows re-request after cooldown has passed", async () => {
    const t0 = new Date("2026-07-11T10:00:00Z");
    const seedClock = new FixedClock(t0);
    const id = await seedSentEstimate(repo, new InMemoryEventBus(), seedClock);

    // First request at t0.
    const r1 = await new RequestEstimateChangeUseCase(repo, new InMemoryEventBus(), new FixedClock(t0)).exec({
      estimateId: id,
      message: "first request",
    });
    expect(isOk(r1)).toBe(true);

    // Second request after 11 minutes — cooldown has passed.
    const t11min = new Date("2026-07-11T10:11:00Z");
    const freshBus = new InMemoryEventBus();
    const r2 = await new RequestEstimateChangeUseCase(repo, freshBus, new FixedClock(t11min)).exec({
      estimateId: id,
      message: "updated request after cooldown",
    });
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value.props.changeRequest).toBe("updated request after cooldown");
    // An event was emitted for the successful re-request.
    expect(freshBus.recorded.filter((e) => e.name === "estimate.change_requested")).toHaveLength(1);
  });
});
