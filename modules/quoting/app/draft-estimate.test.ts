/**
 * Focused unit tests for DraftEstimateUseCase covering branches NOT fully reached by
 * quoting-use-cases.test.ts:
 *
 *  1. All-optional-lines validation error — every line in the command has isOptional:true;
 *     the use-case must return a validation error referencing the "lines" field.
 *
 *  2. EstimateLine.create failure path inside the loop — a line with an invalid field
 *     (blank description, negative quantity, negative rate, sub-cent precision) causes
 *     EstimateLine.create to return err; the use-case must propagate that error immediately.
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
import { Estimate } from "../domain/estimate";
import type { EstimateRepository, EstimateFilter } from "../domain/estimate-repository";
import type { AiDraftSnapshot } from "../domain/edit-delta";
import { DraftEstimateUseCase, type EstimateLineInput } from "./draft-estimate";

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
// Tests
// ---------------------------------------------------------------------------

describe("DraftEstimateUseCase — all-optional-lines validation error", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let draft: DraftEstimateUseCase;

  const cmd = (lines: EstimateLineInput[]) => ({
    orgId: ORG,
    leadId: LEAD,
    title: null,
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    validDays: null,
    lines,
  });

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  });

  it("returns a validation error when all lines are optional", async () => {
    const r = await draft.exec(cmd([oneLine({ isOptional: true })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("lines");
  });

  it("returns an error when multiple lines are all optional", async () => {
    const r = await draft.exec(
      cmd([
        oneLine({ isOptional: true }),
        oneLine({ description: "Add-on A", rateCents: 50_000, isOptional: true }),
        oneLine({ description: "Add-on B", rateCents: 20_000, isOptional: true }),
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("lines");
  });

  it("does NOT return an all-optional error when at least one non-optional line is present", async () => {
    const r = await draft.exec(
      cmd([
        oneLine({ isOptional: false }),
        oneLine({ description: "Add-on", rateCents: 50_000, isOptional: true }),
      ]),
    );
    expect(r.ok).toBe(true);
  });

  it("does not persist or emit events when all-optional validation fails", async () => {
    await draft.exec(cmd([oneLine({ isOptional: true })]));
    // repo.nextNumber is only called after validation — no estimate should be stored
    // and no events should be emitted.
    const stored = await repo.list({ limit: 10, cursor: null });
    expect(stored.items).toHaveLength(0);
    expect(bus.recorded).toHaveLength(0);
  });
});

describe("DraftEstimateUseCase — EstimateLine.create failure path", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let draft: DraftEstimateUseCase;

  const cmd = (lines: EstimateLineInput[]) => ({
    orgId: ORG,
    leadId: LEAD,
    title: null,
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    validDays: null,
    lines,
  });

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  });

  it("propagates the error when a line has a blank description", async () => {
    const r = await draft.exec(cmd([oneLine({ description: "   " })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("description");
  });

  it("propagates the error when a line has a negative quantity", async () => {
    const r = await draft.exec(cmd([oneLine({ quantity: -1 })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("quantity");
  });

  it("propagates the error when a line has a negative rate", async () => {
    const r = await draft.exec(cmd([oneLine({ rateCents: -1 })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("rate");
  });

  it("propagates the error when a line has sub-cent quantity precision", async () => {
    // 3 decimal places is invalid — numeric(12,2) cannot represent it without drift
    const r = await draft.exec(cmd([oneLine({ quantity: 1.555 })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("quantity");
  });

  it("short-circuits on the first invalid line in the loop and does not persist", async () => {
    // First line is valid (non-optional), second is invalid (blank description).
    // The loop must stop at the invalid line and return an error without saving.
    const r = await draft.exec(
      cmd([
        oneLine({ isOptional: false }),
        oneLine({ description: "" }),
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    // No events must be emitted and nothing stored.
    expect(bus.recorded).toHaveLength(0);
    const stored = await repo.list({ limit: 10, cursor: null });
    expect(stored.items).toHaveLength(0);
  });

  it("propagates the error when a line has a negative cost", async () => {
    const r = await draft.exec(cmd([oneLine({ costCents: -100 })]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("validation");
    if (r.error.kind === "validation") expect(r.error.field).toBe("cost");
  });
});

describe("DraftEstimateUseCase — ai_draft snapshot persistence", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let draft: DraftEstimateUseCase;

  const cmd = (lines: EstimateLineInput[]) => ({
    orgId: ORG,
    leadId: LEAD,
    title: null,
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    validDays: null,
    lines,
  });

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    draft = new DraftEstimateUseCase(repo, new InMemoryEventBus(), clock, seqIds());
  });

  it("persists the snapshot (with the draft timestamp) when aiDraftLines is present", async () => {
    const aiLines = [{ description: "Water heater swap labor", quantity: 5, rateCents: 15_000 }];
    const r = await draft.exec({ ...cmd([oneLine()]), aiDraftLines: aiLines });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const snapshot = await repo.getAiDraft(r.value.props.id);
    expect(snapshot).toEqual({ lines: aiLines, at: clock.now().toISOString() });
  });

  it("persists NO snapshot for hand-built drafts", async () => {
    const r = await draft.exec(cmd([oneLine()]));
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(await repo.getAiDraft(r.value.props.id)).toBeNull();
  });
});
