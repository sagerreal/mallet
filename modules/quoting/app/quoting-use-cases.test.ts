import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  FixedClock,
  toPage,
  buildPage,
  decodeCursor,
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
import { AcceptEstimateUseCase } from "./accept-estimate";
import { DeclineEstimateUseCase } from "./decline-estimate";
import { ListEstimatesUseCase } from "./list-estimates";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");

// Deterministic sequential ids for tests.
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

  async list(page: CursorPage, filter?: EstimateFilter): Promise<Paginated<Estimate>> {
    let rows = [...this.store.values()].sort((a, b) => {
      const t = b.props.createdAt.getTime() - a.props.createdAt.getTime();
      return t !== 0 ? t : b.props.id.localeCompare(a.props.id);
    });
    if (filter?.status) rows = rows.filter((e) => e.props.status === filter.status);
    if (page.cursor) {
      const cursor = decodeCursor(page.cursor);
      if (isOk(cursor)) {
        const c = cursor.value;
        rows = rows.filter((e) => {
          const t = e.props.createdAt.getTime();
          return t < c.createdAt.getTime() || (t === c.createdAt.getTime() && e.props.id < c.id);
        });
      }
    }
    return buildPage(rows.slice(0, page.limit + 1), page, (e) => ({
      createdAt: e.props.createdAt,
      id: e.props.id,
    }));
  }

  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Estimate>> {
    return this.list(page);
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

describe("DraftEstimateUseCase", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;
  let draft: DraftEstimateUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
    draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
  });

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

  it("rejects a draft with no lines", async () => {
    const r = await draft.exec(cmd([]));
    expect(r.ok).toBe(false);
  });

  it("rejects a draft with only optional lines", async () => {
    const r = await draft.exec(cmd([oneLine({ isOptional: true })]));
    expect(r.ok).toBe(false);
  });

  it("allocates sequential numbers and emits estimate.drafted once", async () => {
    const first = await draft.exec(cmd([oneLine()]));
    const second = await draft.exec(cmd([oneLine()]));
    expect(isOk(first) && first.value.props.num).toBe("EST-1000");
    expect(isOk(second) && second.value.props.num).toBe("EST-1001");
    expect(bus.recorded.filter((e) => e.name === "estimate.drafted")).toHaveLength(2);
  });
});

describe("Send / Accept / Decline use-cases", () => {
  let clock: FixedClock;
  let repo: FakeEstimateRepository;
  let bus: InMemoryEventBus;

  const seedSentEstimate = async (): Promise<EstimateId> => {
    const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());
    const drafted = await draft.exec({
      orgId: ORG,
      leadId: LEAD,
      title: null,
      discBps: 0,
      taxBps: 0,
      depBps: 2_000,
      validDays: null,
      lines: [oneLine({ rateCents: 100_000 })],
    });
    if (!isOk(drafted)) throw new Error("draft failed");
    const sent = await new SendEstimateUseCase(repo, bus, clock).exec({
      estimateId: drafted.value.props.id,
    });
    if (!isOk(sent)) throw new Error("send failed");
    return sent.value.props.id;
  };

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeEstimateRepository();
    bus = new InMemoryEventBus();
  });

  it("send emits estimate.sent", async () => {
    await seedSentEstimate();
    expect(bus.recorded.some((e) => e.name === "estimate.sent")).toBe(true);
  });

  it("re-sending an already-sent estimate does not re-emit estimate.sent", async () => {
    const id = await seedSentEstimate();
    const sender = new SendEstimateUseCase(repo, bus, clock);
    await sender.exec({ estimateId: id }); // second send — should be a no-op
    expect(bus.recorded.filter((e) => e.name === "estimate.sent")).toHaveLength(1);
  });

  it("send returns notFound for a missing estimate", async () => {
    const r = await new SendEstimateUseCase(repo, bus, clock).exec({
      estimateId: asEstimateId("99999999-9999-9999-9999-999999999999"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("accept emits estimate.accepted with total + deposit", async () => {
    const id = await seedSentEstimate();
    const r = await new AcceptEstimateUseCase(repo, bus, clock).exec({ estimateId: id });
    expect(isOk(r) && r.value.props.status).toBe("accepted");
    const event = bus.recorded.find((e) => e.name === "estimate.accepted");
    expect(event?.payload).toMatchObject({ totalCents: 100_000, depositDueCents: 20_000 });
  });

  it("decline requires a reason and emits estimate.declined", async () => {
    const id = await seedSentEstimate();
    const decliner = new DeclineEstimateUseCase(repo, bus, clock);
    expect((await decliner.exec({ estimateId: id, reason: "  " })).ok).toBe(false);
    const r = await decliner.exec({ estimateId: id, reason: "too expensive" });
    expect(isOk(r) && r.value.props.status).toBe("declined");
    const event = bus.recorded.find((e) => e.name === "estimate.declined");
    expect(event?.payload).toMatchObject({ reason: "too expensive" });
  });
});

describe("ListEstimatesUseCase", () => {
  it("paginates newest-first with a working next cursor and status filter", async () => {
    const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    const repo = new FakeEstimateRepository();
    const bus = new InMemoryEventBus();
    const draft = new DraftEstimateUseCase(repo, bus, clock, seqIds());

    for (let i = 0; i < 3; i += 1) {
      await draft.exec({
        orgId: ORG,
        leadId: LEAD,
        title: `E${i}`,
        discBps: 0,
        taxBps: 0,
        depBps: 0,
        validDays: null,
        lines: [oneLine()],
      });
      clock.advance(60_000);
    }

    const list = new ListEstimatesUseCase(repo);
    const page1 = await list.exec({ page: toPage({ limit: 2 }) });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await list.exec({ page: toPage({ limit: 2, cursor: page1.nextCursor }) });
    expect(page2.items).toHaveLength(1);

    const drafts = await list.exec({ page: toPage(), filter: { status: "draft" } });
    expect(drafts.items).toHaveLength(3);
    const sentOnly = await list.exec({ page: toPage(), filter: { status: "sent" } });
    expect(sentOnly.items).toHaveLength(0);
  });
});
