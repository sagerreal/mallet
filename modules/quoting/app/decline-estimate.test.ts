/**
 * Focused unit tests for DeclineEstimateUseCase covering branches NOT reached by
 * quoting-use-cases.test.ts:
 *
 *  1. not_found — the estimate does not exist in the repo; exec must return a
 *     notFound error and must NOT emit any event.
 *
 *  2. domain error (canDecline guard) — the estimate exists but is in a state
 *     that rejects decline (e.g. draft, already accepted); exec must return a
 *     validation error and must NOT emit any event.
 *
 *  3. event emit path — successful decline emits exactly one estimate.declined
 *     event with the correct orgId, leadId, estimateId, and trimmed reason;
 *     confirming the bus.emit code path is exercised and its payload is correct.
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
import { DeclineEstimateUseCase } from "./decline-estimate";

// ---------------------------------------------------------------------------
// Constants — mirrors quoting-use-cases.test.ts conventions exactly
// ---------------------------------------------------------------------------

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

// ---------------------------------------------------------------------------
// Fake repository — exact same structure as in accept-estimate.test.ts
// ---------------------------------------------------------------------------

class FakeEstimateRepository implements EstimateRepository {
  private readonly store = new Map<EstimateId, Estimate>();
  private readonly archived = new Set<EstimateId>();
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
    if (this.archived.has(id)) return null;
    return this.store.get(id) ?? null;
  }

  async list(_page: CursorPage, _filter?: EstimateFilter): Promise<Paginated<Estimate>> {
    const items = [...this.store.values()].filter((e) => !this.archived.has(e.props.id));
    return { items, nextCursor: null };
  }

  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Estimate>> {
    return this.list(page);
  }

  async archive(id: EstimateId, _now: Date): Promise<number> {
    if (this.archived.has(id) || !this.store.has(id)) return 0;
    this.archived.add(id);
    return 1;
  }

  async restore(id: EstimateId, _now: Date): Promise<Estimate | null> {
    if (!this.archived.has(id)) return null;
    this.archived.delete(id);
    return this.store.get(id) ?? null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const oneLine = (overrides: Partial<EstimateLineInput> = {}): EstimateLineInput => ({
  description: "Labor",
  quantity: 1,
  rateCents: 100_000,
  costCents: 0,
  isOptional: false,
  needsPhoto: false,
  ...overrides,
});

/** Seed an estimate in DRAFT state only (not sent). Returns the estimateId. */
async function seedDraftEstimate(
  repo: FakeEstimateRepository,
  bus: InMemoryEventBus,
  clock: FixedClock,
): Promise<EstimateId> {
  const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  const r = await draft.exec({
    orgId: ORG,
    leadId: LEAD,
    title: null,
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    validDays: null,
    lines: [oneLine()],
  });
  if (!isOk(r)) throw new Error(`draft failed: ${r.error.message}`);
  return r.value.props.id;
}

/** Seed an estimate that has been sent to the customer. Returns the estimateId. */
async function seedSentEstimate(
  repo: FakeEstimateRepository,
  bus: InMemoryEventBus,
  clock: FixedClock,
): Promise<EstimateId> {
  const draftId = await seedDraftEstimate(repo, bus, clock);
  const sent = await new SendEstimateUseCase(repo, bus, clock).exec({ estimateId: draftId });
  if (!isOk(sent)) throw new Error(`send failed: ${sent.error.message}`);
  return sent.value.props.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeclineEstimateUseCase — not_found branch", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("returns a not_found error when the estimate does not exist", async () => {
    const decliner = new DeclineEstimateUseCase(repo, bus, clock);
    const r = await decliner.exec({
      estimateId: asEstimateId("99999999-9999-9999-9999-999999999999"),
      reason: "too expensive",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("does NOT emit any event when the estimate is not found", async () => {
    const decliner = new DeclineEstimateUseCase(repo, bus, clock);
    await decliner.exec({
      estimateId: asEstimateId("99999999-9999-9999-9999-999999999999"),
      reason: "no show",
    });

    expect(bus.recorded).toHaveLength(0);
  });
});

describe("DeclineEstimateUseCase — domain error branch (canDecline guard)", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("returns a validation error when trying to decline a draft (not yet sent)", async () => {
    const draftId = await seedDraftEstimate(repo, bus, clock);
    // Clear the bus so the draft event does not count.
    const freshBus = new InMemoryEventBus();
    const decliner = new DeclineEstimateUseCase(repo, freshBus, clock);

    const r = await decliner.exec({ estimateId: draftId, reason: "changed mind" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("does NOT emit any event when the domain rejects the decline", async () => {
    const draftId = await seedDraftEstimate(repo, bus, clock);
    const freshBus = new InMemoryEventBus();
    const decliner = new DeclineEstimateUseCase(repo, freshBus, clock);

    await decliner.exec({ estimateId: draftId, reason: "changed mind" });

    // Only the draft event was emitted (to bus, not freshBus), so freshBus must be empty.
    expect(freshBus.recorded).toHaveLength(0);
  });
});

describe("DeclineEstimateUseCase — bus.emit path (successful decline)", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("emits exactly one estimate.declined event with the correct payload fields", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    // Clear bus so only the decline event is counted.
    const freshBus = new InMemoryEventBus();
    const decliner = new DeclineEstimateUseCase(repo, freshBus, clock);

    const r = await decliner.exec({ estimateId: id, reason: "  too expensive  " });

    expect(isOk(r)).toBe(true);

    const declined = freshBus.recorded.filter((e) => e.name === "estimate.declined");
    expect(declined).toHaveLength(1);

    const event = declined[0];
    // orgId propagated correctly from the aggregate.
    expect(event?.orgId).toBe(ORG);
    // Payload carries estimateId, leadId, and the TRIMMED reason.
    expect(event?.payload).toMatchObject({
      estimateId: id,
      leadId: LEAD,
      reason: "too expensive",
    });
    // occurredAt matches the clock's fixed instant.
    expect(event?.occurredAt).toEqual(clock.now());
  });

  it("persists the declined estimate so findById returns status=declined with the reason", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    const freshBus = new InMemoryEventBus();
    await new DeclineEstimateUseCase(repo, freshBus, clock).exec({
      estimateId: id,
      reason: "went with competitor",
    });

    const persisted = await repo.findById(id);
    expect(persisted?.props.status).toBe("declined");
    expect(persisted?.props.declineReason).toBe("went with competitor");
    expect(persisted?.props.declinedAt).toEqual(clock.now());
  });

  it("returns the declined Estimate value on success", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    const r = await new DeclineEstimateUseCase(repo, bus, clock).exec({
      estimateId: id,
      reason: "budget cut",
    });

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.status).toBe("declined");
    expect(r.value.props.declineReason).toBe("budget cut");
  });
});
