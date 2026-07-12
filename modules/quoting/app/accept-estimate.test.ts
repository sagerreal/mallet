/**
 * Focused unit tests for AcceptEstimateUseCase covering branches NOT reached by
 * quoting-use-cases.test.ts:
 *
 *  1. lines.length === 0 guard — cmd.lines is an empty array; the use-case must
 *     skip the replacement block entirely and accept the original line set.
 *
 *  2. crypto.randomUUID fallback — no IdGenerator is injected (`ids` is undefined);
 *     the use-case must fall back to `crypto.randomUUID` and still produce a valid
 *     result when cmd.lines are provided.
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
import { AcceptEstimateUseCase, type AcceptLineInput } from "./accept-estimate";

// ---------------------------------------------------------------------------
// Shared constants / helpers (mirrors quoting-use-cases.test.ts conventions)
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

  async archiveByLead(leadId: LeadId, _now: Date): Promise<number> {
    let count = 0;
    for (const [id, est] of this.store) {
      if (est.props.leadId === leadId && !this.archived.has(id)) {
        this.archived.add(id);
        count++;
      }
    }
    return count;
  }
}

const oneLine = (overrides: Partial<EstimateLineInput> = {}): EstimateLineInput => ({
  description: "Labor",
  quantity: 1,
  rateCents: 100_000,
  costCents: 0,
  isOptional: false,
  needsPhoto: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Shared fixture: draft → send, return the id
// ---------------------------------------------------------------------------

async function seedSentEstimate(
  repo: FakeEstimateRepository,
  bus: InMemoryEventBus,
  clock: FixedClock,
  lines: EstimateLineInput[] = [oneLine({ rateCents: 80_000 })],
): Promise<EstimateId> {
  const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  const drafted = await draft.exec({
    orgId: ORG,
    leadId: LEAD,
    title: null,
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    validDays: null,
    lines,
  });
  if (!isOk(drafted)) throw new Error(`draft failed: ${drafted.error.message}`);

  const sent = await new SendEstimateUseCase(repo, bus, clock).exec({
    estimateId: drafted.value.props.id,
  });
  if (!isOk(sent)) throw new Error(`send failed: ${sent.error.message}`);
  return sent.value.props.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AcceptEstimateUseCase — lines-length===0 guard", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("skips line replacement when cmd.lines is an empty array and accepts the original lines", async () => {
    // Seed an estimate with one non-optional line worth $800.
    const id = await seedSentEstimate(repo, bus, clock, [oneLine({ rateCents: 80_000 })]);

    // Pass an empty lines array — the guard (lines.length > 0) must prevent any replacement.
    const r = await new AcceptEstimateUseCase(repo, bus, clock).exec({
      estimateId: id,
      lines: [],
    });

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // Status must be accepted.
    expect(r.value.props.status).toBe("accepted");

    // The original single line ($800) is still the line set — total unchanged.
    expect(r.value.total()).toBe(80_000);

    // Exactly one estimate.accepted event was emitted with the original total.
    const events = bus.recorded.filter((e) => e.name === "estimate.accepted");
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ totalCents: 80_000 });

    // The persisted entity still carries the original single line.
    const persisted = await repo.findById(id);
    expect(persisted?.props.lines).toHaveLength(1);
  });

  it("emits estimate.accepted even when cmd.lines is an empty array", async () => {
    const id = await seedSentEstimate(repo, bus, clock);
    await new AcceptEstimateUseCase(repo, bus, clock).exec({ estimateId: id, lines: [] });
    expect(bus.recorded.some((e) => e.name === "estimate.accepted")).toBe(true);
  });
});

describe("AcceptEstimateUseCase — crypto.randomUUID fallback (no IdGenerator injected)", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("uses crypto.randomUUID when ids is undefined and still commits the lines", async () => {
    const id = await seedSentEstimate(repo, bus, clock, [oneLine({ rateCents: 50_000 })]);

    // Construct AcceptEstimateUseCase WITHOUT an IdGenerator (4th arg omitted → undefined).
    // The use-case must fall back to `crypto.randomUUID` internally.
    const acceptedLines: AcceptLineInput[] = [
      {
        description: "Replaced labor",
        quantity: 2,
        rateCents: 30_000,
        costCents: 0,
        isOptional: false,
        needsPhoto: false,
      },
    ];

    const r = await new AcceptEstimateUseCase(repo, bus, clock).exec({
      estimateId: id,
      lines: acceptedLines,
    });

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    // Status must be accepted.
    expect(r.value.props.status).toBe("accepted");

    // New line: 2 × $300 = $600.
    expect(r.value.subtotal()).toBe(60_000);
    expect(r.value.total()).toBe(60_000);

    // The persisted entity has exactly 1 line matching the replacement.
    const persisted = await repo.findById(id);
    expect(persisted?.props.lines).toHaveLength(1);
    expect(persisted?.props.lines[0]?.props.description).toBe("Replaced labor");
    expect(persisted?.props.lines[0]?.props.quantity).toBe(2);

    // The line ID must be a non-empty string (UUID from crypto.randomUUID).
    const lineId = persisted?.props.lines[0]?.props.id as string;
    expect(typeof lineId).toBe("string");
    expect(lineId.length).toBeGreaterThan(0);

    // The event payload must reflect the new total.
    const event = bus.recorded.find((e) => e.name === "estimate.accepted");
    expect(event?.payload).toMatchObject({ totalCents: 60_000 });
  });

  it("uses crypto.randomUUID for each line independently when multiple lines provided", async () => {
    const id = await seedSentEstimate(repo, bus, clock);

    const r = await new AcceptEstimateUseCase(repo, bus, clock).exec({
      estimateId: id,
      lines: [
        { description: "Line A", quantity: 1, rateCents: 20_000, costCents: 0, isOptional: false, needsPhoto: false },
        { description: "Line B", quantity: 1, rateCents: 30_000, costCents: 0, isOptional: false, needsPhoto: false },
      ],
    });

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;

    const persisted = await repo.findById(id);
    const lineIds = persisted?.props.lines.map((l) => l.props.id) ?? [];

    // Both lines must have received distinct IDs from crypto.randomUUID.
    expect(lineIds).toHaveLength(2);
    expect(new Set(lineIds).size).toBe(2); // all unique
  });
});
