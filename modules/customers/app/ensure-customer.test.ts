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
// one orgId), dedupes on phone, keyset-paginates newest-first, and uses soft-delete (not hard).
class FakeLeadRepository implements LeadRepository {
  private readonly store = new Map<LeadId, Lead>();
  private readonly deletedIds = new Set<LeadId>();

  constructor(
    private readonly orgId: OrgId,
    private readonly clock: FixedClock,
  ) {}

  async ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    if (input.phone !== null) {
      // Only match against active (non-deleted) rows.
      const existing = [...this.store.values()].find(
        (l) => !this.deletedIds.has(l.props.id) && l.props.phone === input.phone,
      );
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
      unread: false,
      wonAt: null,
      companyId: input.companyId,
      role: input.role,
      notes: input.notes,
      address: input.address,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(created)) throw new Error(created.error.message);
    this.store.set(created.value.props.id, created.value);
    return { lead: created.value, created: true };
  }

  async findById(id: LeadId): Promise<Lead | null> {
    if (this.deletedIds.has(id)) return null;
    return this.store.get(id) ?? null;
  }


  async findByPhone(): Promise<Lead | null> {
    return null;
  }

  async findByIds(ids: readonly LeadId[]): Promise<Lead[]> {
    const found: Lead[] = [];
    for (const id of ids) {
      const lead = await this.findById(id);
      if (lead) found.push(lead);
    }
    return found;
  }

  async count(): Promise<number> { return 0; }

  async list(page: CursorPage, filter?: LeadFilter): Promise<Paginated<Lead>> {
    // Exclude soft-deleted rows.
    let rows = [...this.store.values()]
      .filter((l) => !this.deletedIds.has(l.props.id))
      .sort((a, b) => {
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

  // Returns 1 if the lead was active and is now archived; 0 if not found or already archived.
  async archiveByLead(): Promise<number> { return 0; }
  async archive(id: LeadId, _now: Date): Promise<number> {
    if (!this.store.has(id) || this.deletedIds.has(id)) return 0;
    this.deletedIds.add(id);
    return 1;
  }

  // Returns the lead if it was archived and is now restored; null if it was already active.
  async restore(id: LeadId, _now: Date): Promise<Lead | null> {
    if (!this.deletedIds.has(id)) return null;
    this.deletedIds.delete(id);
    return this.store.get(id) ?? null;
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
    const r = await useCase.exec({ name: "   ", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
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
      companyId: null,
      role: null,
      notes: null,
      address: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.created).toBe(true);
      expect(r.value.lead.props.name).toBe("Karen Doyle");
    }
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
      companyId: null,
      role: null,
      notes: null,
      address: null,
    });
    const second = await useCase.exec({
      name: "Karen (again)",
      phone: sharedPhone,
      email: null,
      source: "phone",
      companyId: null,
      role: null,
      notes: null,
      address: null,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      // created flag: first is true, second is false (dedup hit)
      expect(first.value.created).toBe(true);
      expect(second.value.created).toBe(false);
      expect(second.value.lead.props.id).toBe(first.value.lead.props.id);
    }
    const listed = await repo.list(toPage(), undefined);
    expect(listed.items).toHaveLength(1);
    expect(bus.recorded).toHaveLength(1); // only the first creation emitted
  });

  it("dedupes by phone but not by name alone: same name different phone = two records", async () => {
    const r1 = await useCase.exec({ name: "Jane Smith", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
    const r2 = await useCase.exec({ name: "Jane Smith", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      // No phone → no dedup key → two distinct records, both created:true
      expect(r1.value.created).toBe(true);
      expect(r2.value.created).toBe(true);
    }
  });
});

describe("EnsureCustomerUseCase — bug-fix regressions", () => {
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

  it("new lead is created with unread=false (bug fix: no spurious new-text badge)", async () => {
    const r = await useCase.exec({ name: "Sam Parker", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.created).toBe(true);
      expect(r.value.lead.props.unread).toBe(false);
    }
  });

  it("notes are persisted on create (bug fix: notes column now exists)", async () => {
    const r = await useCase.exec({
      name: "Nora Chen",
      phone: null,
      email: null,
      source: null,
      companyId: null,
      role: null,
      notes: "gate code 9988",
      address: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lead.props.notes).toBe("gate code 9988");
    }
  });

  it("null notes on create yields null in the domain", async () => {
    const r = await useCase.exec({ name: "Lee Fox", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.lead.props.notes).toBeNull();
    }
  });

  it("address is persisted on create", async () => {
    const r = await useCase.exec({
      name: "Gary Pratt",
      phone: null,
      email: null,
      source: null,
      companyId: null,
      role: null,
      notes: null,
      address: "789 Pine Rd, Fremont CA 94536",
    });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.lead.props.address).toBe("789 Pine Rd, Fremont CA 94536");
    }
  });

  it("null address on create yields null in the domain", async () => {
    const r = await useCase.exec({ name: "Faye Dunn", phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value.lead.props.address).toBeNull();
    }
  });
});

describe("ListLeadsUseCase", () => {
  it("paginates newest-first and yields a working next cursor", async () => {
    const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    const repo = new FakeLeadRepository(ORG, clock);
    const bus = new InMemoryEventBus();
    const ensure = new EnsureCustomerUseCase(repo, bus, clock);

    for (const name of ["A", "B", "C"]) {
      await ensure.exec({ name, phone: null, email: null, source: null, companyId: null, role: null, notes: null, address: null });
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
