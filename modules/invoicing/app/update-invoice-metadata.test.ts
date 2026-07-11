import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId, asLeadId, asInvoiceId, money, FixedClock, isOk,
  type OrgId, type LeadId, type InvoiceId, type CursorPage, type Paginated,
  buildPage,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Invoice, type InvoiceStatus } from "../domain/invoice";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { Payment } from "../domain/payment";
import type { JobId } from "@mallet/shared/types";
import { UpdateInvoiceMetadataUseCase, type UpdateInvoiceMetadataCommand } from "./update-invoice-metadata";

const ORG: OrgId = asOrgId("11111111-1111-1111-1111-111111111111");
const LEAD: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");
const INV: InvoiceId = asInvoiceId("33333333-3333-3333-3333-333333333333");
const MISSING: InvoiceId = asInvoiceId("99999999-9999-9999-9999-999999999999");

class FakeInvoiceRepository implements InvoiceRepository {
  store = new Map<InvoiceId, Invoice>();
  saveCallCount = 0;
  async nextNumber() { return "INV-1"; }
  async save(i: Invoice) { this.saveCallCount += 1; this.store.set(i.props.id, i); }
  async insertForJob(i: Invoice) { this.store.set(i.props.id, i); return true; }
  async insertPayment(_o: OrgId, _i: InvoiceId, _p: Payment) { return true; }
  async applyPayment(_i: InvoiceId, _a: number): Promise<ApplyResult> { return { applied: false, invoice: null }; }
  async findById(id: InvoiceId) { return this.store.get(id) ?? null; }
  async findBySourceJob(_j: JobId) { return null; }
  async list(p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
    return buildPage([...this.store.values()], p, (i) => ({ createdAt: i.props.createdAt, id: i.props.id }));
  }
  async listByLead(_l: LeadId, p: CursorPage) { return this.list(p); }
  async findOverdue(_n: Date, p: CursorPage) { return this.list(p); }
}

const seed = (repo: FakeInvoiceRepository, status: InvoiceStatus = "draft") => {
  const r = Invoice.create({
    id: INV, orgId: ORG, num: "INV-800", sourceJobId: null, leadId: LEAD,
    title: "Old", status, total: money(100_000), depositPaid: money(0),
    amountPaid: money(0), payments: [], lines: [], termsDays: 7,
    sentAt: null, dueAt: null,
    createdAt: new Date("2026-07-01T00:00:00Z"), updatedAt: new Date("2026-07-01T00:00:00Z"),
  });
  if (!isOk(r)) throw new Error(r.error.message);
  repo.store.set(INV, r.value);
};

describe("UpdateInvoiceMetadataUseCase", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;
  let useCase: UpdateInvoiceMetadataUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
    useCase = new UpdateInvoiceMetadataUseCase(repo, bus, clock);
  });

  it("returns not_found when the invoice does not exist", async () => {
    const cmd: UpdateInvoiceMetadataCommand = { invoiceId: MISSING, termsDays: 30 };
    const res = await useCase.exec(cmd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("not_found");
    expect(repo.saveCallCount).toBe(0);
  });

  it("persists leadId/title/termsDays/depositPaid on success", async () => {
    seed(repo);
    const cmd: UpdateInvoiceMetadataCommand = {
      invoiceId: INV,
      leadId: asLeadId("44444444-4444-4444-4444-444444444444"),
      title: "New",
      termsDays: 30,
      depositPaidCents: 25_000,
    };
    const res = await useCase.exec(cmd);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.props.title).toBe("New");
      expect(res.value.props.termsDays).toBe(30);
      expect(res.value.props.depositPaid).toBe(25_000);
      expect(res.value.props.leadId).toBe("44444444-4444-4444-4444-444444444444");
      expect(res.value.props.updatedAt.toISOString()).toBe(clock.now().toISOString());
    }
    expect(repo.saveCallCount).toBe(1);
  });

  it("returns a validation error and does not save when editing a paid invoice", async () => {
    seed(repo, "paid");
    const res = await useCase.exec({ invoiceId: INV, termsDays: 30 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("validation");
    expect(repo.saveCallCount).toBe(0);
  });

  it("rejects a negative termsDays", async () => {
    seed(repo);
    const res = await useCase.exec({ invoiceId: INV, termsDays: -5 });
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === "validation") expect(res.error.field).toBe("termsDays");
  });
});
