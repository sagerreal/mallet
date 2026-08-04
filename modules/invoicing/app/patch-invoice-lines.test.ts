import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId, asLeadId, asInvoiceId, money, FixedClock, isOk,
  type OrgId, type LeadId, type InvoiceId, type CursorPage, type Paginated, type JobId,
  buildPage,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Invoice, type InvoiceStatus } from "../domain/invoice";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { Payment } from "../domain/payment";
import { PatchInvoiceLinesUseCase, type PatchInvoiceLinesCommand } from "./patch-invoice-lines";

const ORG: OrgId = asOrgId("11111111-1111-1111-1111-111111111111");
const LEAD: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");
const INV: InvoiceId = asInvoiceId("33333333-3333-3333-3333-333333333333");
const MISSING: InvoiceId = asInvoiceId("99999999-9999-9999-9999-999999999999");

const seqIds = (): IdGenerator => {
  let n = 0;
  return { newId: () => { n += 1; return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`; } };
};

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
  async findByPublicToken(_t: string) { return null; }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
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

describe("PatchInvoiceLinesUseCase", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;
  let useCase: PatchInvoiceLinesUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-10T12:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
    useCase = new PatchInvoiceLinesUseCase(repo, bus, clock, seqIds());
  });

  it("returns not_found when the invoice does not exist", async () => {
    const cmd: PatchInvoiceLinesCommand = { invoiceId: MISSING, lines: [] };
    const res = await useCase.exec(cmd);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("not_found");
    expect(repo.saveCallCount).toBe(0);
  });

  it("replaces lines and recomputes the total on a draft", async () => {
    seed(repo);
    const cmd: PatchInvoiceLinesCommand = {
      invoiceId: INV,
      lines: [
        { description: "Labor", quantity: 2, rateCents: 20_000, costCents: 0 },
        { description: "Parts", quantity: 1, rateCents: 5_000, costCents: 0 },
      ],
    };
    const res = await useCase.exec(cmd);
    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.props.lines).toHaveLength(2);
      expect(res.value.props.total).toBe(45_000);
      expect(res.value.props.lines[0]?.props.position).toBe(0);
      expect(res.value.props.lines[1]?.props.position).toBe(1);
    }
    expect(repo.saveCallCount).toBe(1);
  });

  it("recomputes the total for a SENT invoice", async () => {
    seed(repo, "sent");
    const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "X", quantity: 1, rateCents: 30_000, costCents: 0 }] });
    expect(isOk(res)).toBe(true);
    if (isOk(res)) expect(res.value.props.total).toBe(30_000);
  });

  it("returns the InvoiceLine.create error for an empty description (no save)", async () => {
    seed(repo);
    const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "  ", quantity: 1, rateCents: 500, costCents: 0 }] });
    expect(res.ok).toBe(false);
    if (!res.ok && res.error.kind === "validation") expect(res.error.field).toBe("description");
    expect(repo.saveCallCount).toBe(0);
  });

  it("rejects patching lines on a paid invoice", async () => {
    seed(repo, "paid");
    const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "X", quantity: 1, rateCents: 100, costCents: 0 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("validation");
    expect(repo.saveCallCount).toBe(0);
  });

  it("rejects patching lines on a void invoice", async () => {
    seed(repo, "void");
    const res = await useCase.exec({ invoiceId: INV, lines: [{ description: "X", quantity: 1, rateCents: 100, costCents: 0 }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe("validation");
    expect(repo.saveCallCount).toBe(0);
  });
});
