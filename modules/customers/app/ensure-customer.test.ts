import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  asLeadId,
  asOrgId,
  zeroMoney,
  Phone,
  FixedClock,
  toPage,
  buildPage,
  decodeCursor,
  isOk,
  type OrgId,
  type LeadId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Lead } from "../domain/lead";
import type {
  LeadRepository,
  EnsureCustomerInput,
  EnsureCustomerResult,
  LeadFilter,
} from "../domain/lead-repository";
import { EnsureCustomerUseCase } from "./ensure-customer";
import { ListLeadsUseCase } from "./list-leads";

// In-memory test double. Mirrors the real repo's contract: org-scoped (it is constructed with
// one orgId), dedupes on phone, keyset-paginates newest-first.
class FakeLeadRepository implements LeadRepository {
  private readonly store = new Map<LeadId, Lead>();

  constructor(
    private readonly orgId: OrgId,
    private readonly clock: FixedClock,
  ) {}

  async ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    if (input.phone !== null) {
      const existing = [...this.store.values()].find((l) => l.props.phone === input.phone);
      if (existing) return { lead: existing, created: false };
    }
    const now = this.clock.now();
    const created = Lead.create({
      id: asLeadId(randomUUID()),
      orgId: this.orgId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      source: input.source,
      stage: "new",
      value: zeroMoney,
      unread: true,
      wonAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(created)) throw new Error(created.error.message);
    this.store.set(created.value.props.id, created.value);
    return { lead: created.value, created: true };
  }

  async findById(id: LeadId): Promise<Lead | null> {
    return this.store.get(id) ?? null;
  }

  async list(page: CursorPage, filter?: LeadFilter): Promise<Paginated<Lead>> {
    let rows = [...this.store.values()].sort((a, b) => {
      const t = b.props.createdAt.getTime() - a.props.createdAt.getTime();
      return t !== 0 ? t : b.props.id.localeCompare(a.props.id);
    });
    if (filter?.stage) rows = rows.filter((l) => l.props.stage === filter.stage);
    if (filter?.unreadOnly) rows = rows.filter((l) => l.props.unread);
    if (page.cursor) {
      const c = decodeCursor(page.cursor);
      if (isOk(c)) {
        const after = c.value;
        rows = rows.filter((l) => {
          const t = l.props.createdAt.getTime();
          return t < after.createdAt.getTime() || (t === after.createdAt.getTime() && l.props.id < after.id);
        });
      }
    }
    return buildPage(rows.slice(0, page.limit + 1), page, (l) => ({
      createdAt: l.props.createdAt,
      id: l.props.id,
    }));
  }

  async save(lead: Lead): Promise<void> {
    this.store.set(lead.props.id, lead);
  }
}

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");

describe("EnsureCustomerUseCase", () => {
  let clock: FixedClock;
  let repo: FakeLeadRepository;
  let bus: InMemoryEventBus;
  let useCase: EnsureCustomerUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeLeadRepository(ORG, clock);
    bus = new InMemoryEventBus();
    useCase = new EnsureCustomerUseCase(repo, bus, clock);
  });

  it("rejects an empty name", async () => {
    const r = await useCase.exec({ name: "   ", phone: null, email: null, source: null });
    expect(r.ok).toBe(false);
  });

  it("creates a new customer and emits customer.created", async () => {
    const phone = Phone.parse("555-123-4567");
    expect(phone.ok).toBe(true);
    const r = await useCase.exec({
      name: "Karen Doyle",
      phone: phone.ok ? phone.value : null,
      email: null,
      source: "web",
    });
    expect(r.ok).toBe(true);
    expect(bus.recorded).toHaveLength(1);
    expect(bus.recorded[0]?.name).toBe("customer.created");
  });

  it("dedupes on phone: two calls return one record, one event", async () => {
    const phone = Phone.parse("555-123-4567");
    const sharedPhone = phone.ok ? phone.value : null;
    const first = await useCase.exec({
      name: "Karen Doyle",
      phone: sharedPhone,
      email: null,
      source: "web",
    });
    const second = await useCase.exec({
      name: "Karen (again)",
      phone: sharedPhone,
      email: null,
      source: "phone",
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.props.id).toBe(first.value.props.id);
    }
    const listed = await repo.list(toPage(), undefined);
    expect(listed.items).toHaveLength(1);
    expect(bus.recorded).toHaveLength(1); // only the first creation emitted
  });
});

describe("ListLeadsUseCase", () => {
  it("paginates newest-first and yields a working next cursor", async () => {
    const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    const repo = new FakeLeadRepository(ORG, clock);
    const bus = new InMemoryEventBus();
    const ensure = new EnsureCustomerUseCase(repo, bus, clock);

    for (const name of ["A", "B", "C"]) {
      await ensure.exec({ name, phone: null, email: null, source: null });
      clock.advance(60_000);
    }

    const list = new ListLeadsUseCase(repo);
    const firstPage = await list.exec({ page: toPage({ limit: 2 }) });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0]?.props.name).toBe("C"); // newest first
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await list.exec({ page: toPage({ limit: 2, cursor: firstPage.nextCursor }) });
    expect(secondPage.items[0]?.props.name).toBe("A");
  });
});
