import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asInvoiceId,
  money,
  FixedClock,
  toPage,
  buildPage,
  decodeCursor,
  externalService,
  err,
  ok,
  isOk,
  type OrgId,
  type LeadId,
  type JobId,
  type InvoiceId,
  type CursorPage,
  type Paginated,
  type Result,
  type ExternalServiceError,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { Payment } from "../domain/payment";
import type { JobReader, JobSummary } from "../domain/job-reader";
import type {
  PaymentGateway,
  RecordPaymentGatewayCmd,
  PaymentReceipt,
} from "../domain/payment-gateway";
import { ManualPaymentGateway } from "../infra/manual-payment-gateway";
import { DraftInvoiceUseCase } from "./draft-invoice";
import { CreateInvoiceFromJobUseCase } from "./create-invoice-from-job";
import { SendInvoiceUseCase } from "./send-invoice";
import { RecordPaymentUseCase } from "./record-payment";
import { VoidInvoiceUseCase } from "./void-invoice";
import { ListInvoicesUseCase } from "./list-invoices";

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const JOB: JobId = asJobId("44444444-4444-4444-4444-444444444444");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

class FakeInvoiceRepository implements InvoiceRepository {
  private readonly store = new Map<InvoiceId, Invoice>();
  private readonly usedKeys = new Set<string>();
  private seq = 1000;

  async nextNumber(): Promise<string> {
    const v = this.seq;
    this.seq += 1;
    return `INV-${v}`;
  }
  async save(invoice: Invoice): Promise<void> {
    this.store.set(invoice.props.id, invoice);
  }
  async insertForJob(invoice: Invoice): Promise<boolean> {
    const src = invoice.props.sourceJobId;
    if (src && [...this.store.values()].some((i) => i.props.sourceJobId === src)) return false;
    this.store.set(invoice.props.id, invoice);
    return true;
  }
  async insertPayment(orgId: OrgId, _invoiceId: InvoiceId, payment: Payment): Promise<boolean> {
    const key = `${orgId}:${payment.props.idempotencyKey}`;
    if (this.usedKeys.has(key)) return false;
    this.usedKeys.add(key);
    return true;
  }
  async applyPayment(invoiceId: InvoiceId, amountCents: number): Promise<ApplyResult> {
    const inv = this.store.get(invoiceId);
    if (!inv) return { applied: false, invoice: null };
    // Mirror the SQL guard: only a payable (sent|partial) row is incremented.
    if (inv.props.status !== "sent" && inv.props.status !== "partial") return { applied: false, invoice: inv };
    const p = inv.props;
    const amountPaid = money(p.amountPaid + amountCents);
    const remaining = Math.max(0, p.total - p.depositPaid - amountPaid);
    const updated = Invoice.create({ ...p, amountPaid, status: remaining === 0 ? "paid" : "partial" });
    if (!isOk(updated)) throw new Error(updated.error.message);
    this.store.set(invoiceId, updated.value);
    return { applied: true, invoice: updated.value };
  }
  async findById(id: InvoiceId): Promise<Invoice | null> {
    return this.store.get(id) ?? null;
  }
  async findBySourceJob(jobId: JobId): Promise<Invoice | null> {
    return [...this.store.values()].find((i) => i.props.sourceJobId === jobId) ?? null;
  }
  async list(page: CursorPage, filter?: InvoiceFilter): Promise<Paginated<Invoice>> {
    let rows = [...this.store.values()].sort((a, b) => {
      const t = b.props.createdAt.getTime() - a.props.createdAt.getTime();
      return t !== 0 ? t : b.props.id.localeCompare(a.props.id);
    });
    if (filter?.status) rows = rows.filter((i) => i.props.status === filter.status);
    if (page.cursor) {
      const c = decodeCursor(page.cursor);
      if (isOk(c)) {
        rows = rows.filter((i) => {
          const t = i.props.createdAt.getTime();
          return t < c.value.createdAt.getTime() || (t === c.value.createdAt.getTime() && i.props.id < c.value.id);
        });
      }
    }
    return buildPage(rows.slice(0, page.limit + 1), page, (i) => ({
      createdAt: i.props.createdAt,
      id: i.props.id,
    }));
  }
  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Invoice>> {
    return this.list(page);
  }
  async findOverdue(now: Date, page: CursorPage): Promise<Paginated<Invoice>> {
    const overdue = [...this.store.values()].filter((i) => i.isOverdue(now));
    return buildPage(overdue.slice(0, page.limit + 1), page, (i) => ({
      createdAt: i.props.createdAt,
      id: i.props.id,
    }));
  }
}

class FakeJobReader implements JobReader {
  constructor(private readonly summary: JobSummary | null) {}
  async read(jobId: JobId): Promise<JobSummary | null> {
    return this.summary && this.summary.id === jobId ? this.summary : null;
  }
}

class CountingManualGateway implements PaymentGateway {
  public calls = 0;
  private readonly inner: ManualPaymentGateway;
  constructor(clock: FixedClock) {
    this.inner = new ManualPaymentGateway(clock);
  }
  recordPayment(cmd: RecordPaymentGatewayCmd): Promise<Result<PaymentReceipt, ExternalServiceError>> {
    this.calls += 1;
    return this.inner.recordPayment(cmd);
  }
}

const failingGateway: PaymentGateway = {
  recordPayment: async () => err(externalService("stripe", "gateway down", true)),
};

const completeJob = (): JobSummary => ({
  id: JOB,
  leadId: LEAD,
  title: "Deck",
  status: "complete",
  totalCents: 100_000,
});

describe("DraftInvoiceUseCase", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;
  let draft: DraftInvoiceUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
    draft = new DraftInvoiceUseCase(repo, bus, clock, seqIds());
  });

  const cmd = () => ({
    orgId: ORG,
    leadId: LEAD,
    title: "Manual",
    termsDays: 7,
    lines: [{ description: "Labor", quantity: 2, rateCents: 25_000, costCents: 0 }],
  });

  it("allocates sequential INV numbers, totals the lines, and emits invoice.drafted", async () => {
    const a = await draft.exec(cmd());
    const b = await draft.exec(cmd());
    expect(isOk(a) && a.value.props.num).toBe("INV-1000");
    expect(isOk(b) && b.value.props.num).toBe("INV-1001");
    if (isOk(a)) expect(a.value.props.total).toBe(50_000); // 2 * $250
    expect(bus.recorded.filter((e) => e.name === "invoice.drafted")).toHaveLength(2);
  });

  it("rejects an empty invoice", async () => {
    const r = await draft.exec({ ...cmd(), lines: [] });
    expect(r.ok).toBe(false);
  });
});

describe("CreateInvoiceFromJobUseCase", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
  });

  const useCase = (reader: JobReader) =>
    new CreateInvoiceFromJobUseCase(repo, reader, bus, clock, seqIds());

  it("rejects a job that is not complete (conflict) and a missing job (not_found)", async () => {
    const notComplete = await useCase(new FakeJobReader({ ...completeJob(), status: "scheduled" })).exec({
      orgId: ORG,
      jobId: JOB,
    });
    expect(notComplete.ok).toBe(false);
    if (!notComplete.ok) expect(notComplete.error.kind).toBe("conflict");

    const missing = await useCase(new FakeJobReader(null)).exec({ orgId: ORG, jobId: JOB });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.kind).toBe("not_found");
  });

  it("snapshots the job total and is idempotent", async () => {
    const uc = useCase(new FakeJobReader(completeJob()));
    const first = await uc.exec({ orgId: ORG, jobId: JOB });
    expect(isOk(first) && first.value.props.total).toBe(100_000);
    const second = await uc.exec({ orgId: ORG, jobId: JOB });
    expect(isOk(first) && isOk(second) && first.value.props.id === second.value.props.id).toBe(true);
    expect(bus.recorded.filter((e) => e.name === "invoice.created")).toHaveLength(1);
  });
});

describe("Send / RecordPayment / Void use-cases", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;

  const seedSentInvoice = async (): Promise<InvoiceId> => {
    const drafted = await new DraftInvoiceUseCase(repo, bus, clock, seqIds()).exec({
      orgId: ORG,
      leadId: LEAD,
      title: "Job",
      termsDays: 7,
      lines: [{ description: "Work", quantity: 1, rateCents: 100_000, costCents: 0 }],
    });
    if (!isOk(drafted)) throw new Error("draft failed");
    const sent = await new SendInvoiceUseCase(repo, bus, clock).exec({ invoiceId: drafted.value.props.id });
    if (!isOk(sent)) throw new Error("send failed");
    return sent.value.props.id;
  };

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
  });

  it("send emits invoice.sent with a due date", async () => {
    await seedSentInvoice();
    const sent = bus.recorded.find((e) => e.name === "invoice.sent");
    expect(sent?.payload.dueAt).toBeTruthy();
  });

  it("records a payment to fully paid via the manual gateway", async () => {
    const id = await seedSentInvoice();
    const gateway = new CountingManualGateway(clock);
    const uc = new RecordPaymentUseCase(repo, gateway, bus, clock, seqIds());
    const r = await uc.exec({
      orgId: ORG,
      invoiceId: id,
      amount: money(100_000),
      method: "cash",
      idempotencyKey: "pay-key-0001",
    });
    expect(isOk(r) && r.value.props.status).toBe("paid");
    if (isOk(r)) expect(r.value.due()).toBe(0);
    expect(bus.recorded.some((e) => e.name === "invoice.paid")).toBe(true);
    expect(gateway.calls).toBe(1);
  });

  it("is idempotent on a repeated idempotency key — no double-apply, gateway once", async () => {
    const id = await seedSentInvoice();
    const gateway = new CountingManualGateway(clock);
    const uc = new RecordPaymentUseCase(repo, gateway, bus, clock, seqIds());
    const cmd = {
      orgId: ORG,
      invoiceId: id,
      amount: money(40_000),
      method: "cash" as const,
      idempotencyKey: "pay-key-dup1",
    };
    const first = await uc.exec(cmd);
    const second = await uc.exec(cmd);
    expect(isOk(first) && isOk(second)).toBe(true);
    if (isOk(second)) expect(second.value.props.amountPaid).toBe(40_000); // NOT 80000
    expect(gateway.calls).toBe(1); // second call short-circuited before the gateway
    expect(bus.recorded.filter((e) => e.name === "invoice.payment.recorded")).toHaveLength(1);
  });

  it("maps a gateway failure to an external_service error", async () => {
    const id = await seedSentInvoice();
    const uc = new RecordPaymentUseCase(repo, failingGateway, bus, clock, seqIds());
    const r = await uc.exec({
      orgId: ORG,
      invoiceId: id,
      amount: money(10_000),
      method: "card",
      idempotencyKey: "pay-key-fail1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("external_service");
  });

  it("rejects a payment on a draft invoice (money is tracked only after sending)", async () => {
    const drafted = await new DraftInvoiceUseCase(repo, bus, clock, seqIds()).exec({
      orgId: ORG,
      leadId: LEAD,
      title: "Draft",
      termsDays: 7,
      lines: [{ description: "x", quantity: 1, rateCents: 50_000, costCents: 0 }],
    });
    if (!isOk(drafted)) throw new Error("draft failed");
    const r = await new RecordPaymentUseCase(repo, new CountingManualGateway(clock), bus, clock, seqIds()).exec({
      orgId: ORG,
      invoiceId: drafted.value.props.id,
      amount: money(10_000),
      method: "cash",
      idempotencyKey: "pay-key-draft1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");
  });

  it("void rejects a paid invoice", async () => {
    const id = await seedSentInvoice();
    const gateway = new CountingManualGateway(clock);
    await new RecordPaymentUseCase(repo, gateway, bus, clock, seqIds()).exec({
      orgId: ORG,
      invoiceId: id,
      amount: money(100_000),
      method: "cash",
      idempotencyKey: "pay-key-full1",
    });
    const voided = await new VoidInvoiceUseCase(repo, bus, clock).exec({ invoiceId: id });
    expect(voided.ok).toBe(false);
  });
});

describe("ListInvoicesUseCase", () => {
  it("paginates newest-first with a next cursor and status filter", async () => {
    const clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    const repo = new FakeInvoiceRepository();
    const bus = new InMemoryEventBus();
    const draft = new DraftInvoiceUseCase(repo, bus, clock, seqIds());
    for (let i = 0; i < 3; i += 1) {
      await draft.exec({
        orgId: ORG,
        leadId: LEAD,
        title: `I${i}`,
        termsDays: 7,
        lines: [{ description: "x", quantity: 1, rateCents: 1_000, costCents: 0 }],
      });
      clock.advance(60_000);
    }
    const list = new ListInvoicesUseCase(repo);
    const page1 = await list.exec({ page: toPage({ limit: 2 }) });
    expect(page1.items).toHaveLength(2);
    const page2 = await list.exec({ page: toPage({ limit: 2, cursor: page1.nextCursor }) });
    expect(page2.items).toHaveLength(1);
    const drafts = await list.exec({ page: toPage(), filter: { status: "draft" } });
    expect(drafts.items).toHaveLength(3);
    const paid = await list.exec({ page: toPage(), filter: { status: "paid" } });
    expect(paid.items).toHaveLength(0);
  });
});
