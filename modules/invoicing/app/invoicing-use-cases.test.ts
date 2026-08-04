import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asEstimateId,
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
import type { JobReader, JobSummary, JobLineSummary } from "../domain/job-reader";
import type { EstimateDepositReader } from "../domain/estimate-deposit-reader";
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
  async findByPublicToken(token: string): Promise<Invoice | null> {
    for (const invoice of this.store.values()) {
      if (invoice.props.publicToken === token) return invoice;
    }
    return null;
  }

  async findBySourceJob(jobId: JobId): Promise<Invoice | null> {
    return [...this.store.values()].find((i) => i.props.sourceJobId === jobId) ?? null;
  }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
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

// Explicit stub: every estimate reads as "no deposit paid". Tests that care supply their own.
const noDeposits: EstimateDepositReader = { depositPaidCents: async () => 0 };

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
  kind: "work",
  num: "JOB-1042",
  sourceEstimateId: null,
  lines: [],
  totalCents: 100_000,
  // A real split — a use-case that dropped it would be caught, not pass on two zeroes.
  taxBps: 875,
  taxCents: 8_855,
});

const jobLine = (over: Partial<JobLineSummary> = {}): JobLineSummary => ({
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  description: "Drain cleaning",
  quantity: 1,
  rateCents: 9_900,
  costCents: 0,
  position: 0,
  ...over,
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

  const useCase = (reader: JobReader, deposits: EstimateDepositReader = noDeposits) =>
    new CreateInvoiceFromJobUseCase(repo, reader, deposits, bus, clock, seqIds());

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

  // House convention: client-authored UUIDs are preserved by create endpoints where the store
  // needs the id synchronously. Without this, the store's optimistic row and the server row had
  // DIFFERENT ids, and every later mutation keyed on the store id (send, recordPayment,
  // createPayment, get) was NOT_FOUND while the UI showed success.
  it("honors a client-authored id for the NEW row (store id === server id)", async () => {
    const CLIENT_ID = asInvoiceId("77777777-7777-7777-7777-777777777777");
    const uc = useCase(new FakeJobReader(completeJob()));
    const result = await uc.exec({ orgId: ORG, jobId: JOB, id: CLIENT_ID });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(CLIENT_ID);
  });

  it("IGNORES the client id when the job already has an invoice (idempotent path wins)", async () => {
    const uc = useCase(new FakeJobReader(completeJob()));
    const first = await uc.exec({ orgId: ORG, jobId: JOB });
    const CLIENT_ID = asInvoiceId("77777777-7777-7777-7777-777777777777");
    const second = await uc.exec({ orgId: ORG, jobId: JOB, id: CLIENT_ID });
    expect(isOk(first) && isOk(second)).toBe(true);
    if (!isOk(first) || !isOk(second)) return;
    expect(second.value.props.id).toBe(first.value.props.id);
    expect(second.value.props.id).not.toBe(CLIENT_ID);
    // Still exactly one create event — the second call adopted, not minted.
    expect(bus.recorded.filter((e) => e.name === "invoice.created")).toHaveLength(1);
  });

  /**
   * The point of the whole change. The tax was ALREADY inside the total — it rode from the
   * estimate's rounding chain into the job and on to here — but nothing recorded how much of it
   * was tax, so QuickBooks would have received revenue and sales-tax liability as one lump and the
   * document could not itemise it.
   */
  it("carries the tax split from the job without touching the total", async () => {
    const uc = useCase(new FakeJobReader(completeJob()));
    const res = await uc.exec({ orgId: ORG, jobId: JOB });
    expect(isOk(res)).toBe(true);
    if (!isOk(res)) return;
    // The total is untouched — the tax was always inside it.
    expect(res.value.props.total).toBe(100_000);
    expect(res.value.props.taxBps).toBe(875);
    expect(res.value.props.tax).toBe(8_855);
  });


  /**
   * The belt-and-braces behind the UI gates: a done, UNPRICED estimate is a scoping visit —
   * minting a $0 draft from it buries real receivables under meaningless paper. The founder hit
   * exactly this: "Create the invoice →" on a finished scoping visit produced an empty $0 draft.
   */
  it("rejects a zero-total estimate with no priced lines (conflict, named)", async () => {
    const scopingVisit: JobSummary = {
      ...completeJob(),
      kind: "estimate",
      totalCents: 0,
      taxCents: 0,
      lines: [],
    };
    const result = await useCase(new FakeJobReader(scopingVisit)).exec({ orgId: ORG, jobId: JOB });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("conflict");
      expect(result.error.message).toBe("this estimate has no price — quote it before billing");
    }
    expect(bus.recorded).toHaveLength(0);
  });

  it("still invoices an estimate signed on site (priced lines; total_cents never synced)", async () => {
    // The sign path writes priced job_lines and does NOT update the total_cents snapshot —
    // the priced lines are what keep a sold estimate billable.
    const signed: JobSummary = {
      ...completeJob(),
      kind: "estimate",
      totalCents: 0,
      taxCents: 0,
      lines: [jobLine()],
    };
    const result = await useCase(new FakeJobReader(signed)).exec({ orgId: ORG, jobId: JOB });
    expect(isOk(result)).toBe(true);
  });

  it("still invoices an estimate whose job carries an accepted-quote total", async () => {
    const accepted: JobSummary = { ...completeJob(), kind: "estimate" };
    const result = await useCase(new FakeJobReader(accepted)).exec({ orgId: ORG, jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.total).toBe(100_000);
  });

  it("copies priced job lines onto the invoice (sourceJobLineId set) and totals them", async () => {
    const priced: JobSummary = {
      ...completeJob(),
      totalCents: 9_900,
      taxBps: 0,
      taxCents: 0,
      lines: [jobLine()],
    };
    const result = await useCase(new FakeJobReader(priced)).exec({ orgId: ORG, jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const lines = result.value.props.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]?.props.description).toBe("Drain cleaning");
    expect(lines[0]?.props.quantity).toBe(1);
    expect(lines[0]?.props.rate).toBe(9_900);
    expect(lines[0]?.props.sourceJobLineId).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(result.value.props.total).toBe(9_900);
    expect(result.value.props.tax).toBe(0);
  });

  it("derives the total from priced lines when the job's totalCents snapshot is stale 0", async () => {
    // The on-site sign path writes job_lines and never updates total_cents — the snapshot lies.
    const stale: JobSummary = {
      ...completeJob(),
      totalCents: 0,
      taxCents: 0,
      taxBps: 875,
      lines: [jobLine({ quantity: 2, rateCents: 10_000 })],
    };
    const result = await useCase(new FakeJobReader(stale)).exec({ orgId: ORG, jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // subtotal 20_000 + round(20_000 × 875 / 10_000) = 20_000 + 1_750
    expect(result.value.props.total).toBe(21_750);
    expect(result.value.props.tax).toBe(1_750);
    expect(result.value.props.taxBps).toBe(875);
  });

  it("credits the source estimate's paid deposit onto the invoice", async () => {
    const EST = asEstimateId("55555555-5555-5555-5555-555555555555");
    const fromEstimate: JobSummary = { ...completeJob(), sourceEstimateId: EST };
    const deposits: EstimateDepositReader = {
      depositPaidCents: async (orgId, estimateId) =>
        orgId === ORG && estimateId === EST ? 5_000 : 0,
    };
    const result = await useCase(new FakeJobReader(fromEstimate), deposits).exec({
      orgId: ORG,
      jobId: JOB,
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.depositPaid).toBe(5_000);
    // The bill asks for what is still owed: total − deposit − paid.
    expect(result.value.due()).toBe(95_000);
  });

  it("keeps the snapshot fallback when the job has no priced lines: total from the job, no lines", async () => {
    const result = await useCase(new FakeJobReader(completeJob())).exec({ orgId: ORG, jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.total).toBe(100_000);
    expect(result.value.props.tax).toBe(8_855);
    expect(result.value.props.lines).toHaveLength(0);
    expect(result.value.props.depositPaid).toBe(0);
  });

  it("uses zeroMoney when the job totalCents is 0", async () => {
    // Tax is a part of the total, so a zero total carries none.
    const zeroJob: JobSummary = { ...completeJob(), totalCents: 0, taxCents: 0 };
    const uc = useCase(new FakeJobReader(zeroJob));
    const result = await uc.exec({ orgId: ORG, jobId: JOB });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      // total must be 0 (zeroMoney), not an error and not a positive amount
      expect(result.value.props.total).toBe(0);
    }
    // The invoice.created event is emitted even for a zero-total job
    expect(bus.recorded.some((e) => e.name === "invoice.created")).toBe(true);
  });

  it("race-condition path: insertForJob races and winner row is found by re-fetch", async () => {
    // Simulate a race where another writer inserted first:
    // - insertForJob returns false (conflict at the DB unique constraint)
    // - the subsequent findBySourceJob sees the winner row that the other writer inserted
    const winner = await (() => {
      // Seed the invoice using a separate bus so the seed's invoice.created event
      // does not pollute the shared bus we assert against below
      const seedBus = new InMemoryEventBus();
      const seedRepo = new FakeInvoiceRepository();
      const seedUc = new CreateInvoiceFromJobUseCase(seedRepo, new FakeJobReader(completeJob()), noDeposits, seedBus, clock, seqIds());
      return seedUc.exec({ orgId: ORG, jobId: JOB }).then((r) => {
        if (!isOk(r)) throw new Error("seed failed");
        return r.value;
      });
    })();

    // Now build a repo that:
    //   1. starts empty (findBySourceJob returns null on first call, simulating the window between
    //      the initial check and the insert)
    //   2. insertForJob always returns false (the other writer won the race)
    //   3. findBySourceJob on the re-fetch returns the winner
    class RaceRepo extends FakeInvoiceRepository {
      private firstFindDone = false;
      override async findBySourceJob(jobId: JobId): Promise<Invoice | null> {
        if (!this.firstFindDone) {
          this.firstFindDone = true;
          return null; // pre-insert check: looks empty
        }
        return winner; // re-fetch after the failed insert: finds the winner
      }
      override async insertForJob(_invoice: Invoice): Promise<boolean> {
        return false; // lost the race
      }
    }

    const raceRepo = new RaceRepo();
    const uc = new CreateInvoiceFromJobUseCase(raceRepo, new FakeJobReader(completeJob()), noDeposits, bus, clock, seqIds());
    const result = await uc.exec({ orgId: ORG, jobId: JOB });

    // Must return the winner row (ok), NOT a conflict error
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.id).toBe(winner.props.id);
    }
    // No invoice.created event emitted when we lost the race
    expect(bus.recorded.filter((e) => e.name === "invoice.created")).toHaveLength(0);
  });

  it("race-condition path: insertForJob races and re-fetch also finds nothing → conflict error", async () => {
    // Simulate a degenerate race where:
    //   - insertForJob returns false (DB conflict)
    //   - the re-fetch also returns null (winner was voided/deleted between insert and re-fetch)
    class GhostRaceRepo extends FakeInvoiceRepository {
      private firstFindDone = false;
      override async findBySourceJob(_jobId: JobId): Promise<Invoice | null> {
        if (!this.firstFindDone) {
          this.firstFindDone = true;
          return null; // pre-insert check: empty
        }
        return null; // re-fetch: also empty (ghost race)
      }
      override async insertForJob(_invoice: Invoice): Promise<boolean> {
        return false; // lost the race
      }
    }

    const ghostRepo = new GhostRaceRepo();
    const uc = new CreateInvoiceFromJobUseCase(ghostRepo, new FakeJobReader(completeJob()), noDeposits, bus, clock, seqIds());
    const result = await uc.exec({ orgId: ORG, jobId: JOB });

    // Must return a conflict error, not crash and not return ok
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("conflict");
      expect(result.error.message).toMatch(/already exists/i);
    }
    // No event emitted
    expect(bus.recorded.filter((e) => e.name === "invoice.created")).toHaveLength(0);
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

  it("void returns not_found when the invoice does not exist", async () => {
    const uc = new VoidInvoiceUseCase(repo, bus, clock);
    const r = await uc.exec({ invoiceId: asInvoiceId("ffffffff-ffff-ffff-ffff-ffffffffffff") });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });

  it("void happy path: saves the updated invoice and emits invoice.voided for a live invoice", async () => {
    const id = await seedSentInvoice();
    const eventsBefore = bus.recorded.length;
    const uc = new VoidInvoiceUseCase(repo, bus, clock);

    const result = await uc.exec({ invoiceId: id });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // The returned invoice is now void.
    expect(result.value.props.status).toBe("void");

    // repo.save was called: the stored record must reflect void status.
    const stored = await repo.findById(id);
    expect(stored?.props.status).toBe("void");

    // bus.emit was called with exactly one invoice.voided event carrying correct IDs.
    const voidedEvents = bus.recorded.slice(eventsBefore).filter((e) => e.name === "invoice.voided");
    expect(voidedEvents).toHaveLength(1);
    const voidedEvent = voidedEvents[0]!;
    expect(voidedEvent.payload.invoiceId).toBe(id);
    expect(voidedEvent.payload.leadId).toBe(LEAD);
  });

  it("void is idempotent on an already-voided invoice: no repo.save and no event emitted", async () => {
    const id = await seedSentInvoice();
    const uc = new VoidInvoiceUseCase(repo, bus, clock);

    // First void: live → void.
    const first = await uc.exec({ invoiceId: id });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) return;
    expect(first.value.props.status).toBe("void");

    // Capture the stored object reference and bus length before the second call.
    const storedBefore = await repo.findById(id);
    const eventCountBefore = bus.recorded.length;

    // Second void: already void → idempotent no-op (voided.value === invoice branch).
    const second = await uc.exec({ invoiceId: id });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.value.props.status).toBe("void");

    // repo.save must NOT have been called: the stored reference is unchanged.
    const storedAfter = await repo.findById(id);
    expect(storedAfter).toBe(storedBefore);

    // bus.emit must NOT have been called: no new events.
    expect(bus.recorded.length).toBe(eventCountBefore);
  });

  // Exercises record-payment.ts line 75-79: applyPayment returns applied=false with a non-null
  // invoice — simulates a concurrent void/pay committing between the findById read and the
  // guarded UPDATE inside applyPayment. The use-case must return a conflict error and must NOT
  // emit any events.
  it("returns conflict when applyPayment guard fires (concurrent void/pay race)", async () => {
    const id = await seedSentInvoice();
    const sentInvoice = await repo.findById(id);
    if (!sentInvoice) throw new Error("setup: invoice not found");

    // A thin repo override: findById and insertPayment behave normally (sent invoice is visible
    // and the key is new), but applyPayment returns applied=false to simulate the race.
    class RacingRepo extends FakeInvoiceRepository {
      override async applyPayment(_invoiceId: InvoiceId, _amountCents: number): Promise<ApplyResult> {
        // Return the sent invoice with applied=false — mirrors the SQL guard returning 0 rows.
        return { applied: false, invoice: sentInvoice };
      }
    }

    const raceRepo = new RacingRepo();
    await raceRepo.save(sentInvoice); // seed so findById works

    const gateway = new CountingManualGateway(clock);
    const raceBus = new InMemoryEventBus();
    const uc = new RecordPaymentUseCase(raceRepo, gateway, raceBus, clock, seqIds());
    const r = await uc.exec({
      orgId: ORG,
      invoiceId: id,
      amount: money(10_000),
      method: "cash",
      idempotencyKey: "pay-key-race1",
    });

    // Must be a conflict error, not a success or any other kind.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("conflict");

    // Gateway was called once (the key was new), but no events must have been emitted.
    expect(gateway.calls).toBe(1);
    expect(raceBus.recorded.some((e) => e.name === "invoice.payment.recorded")).toBe(false);
    expect(raceBus.recorded.some((e) => e.name === "invoice.paid")).toBe(false);
  });

  // Exercises record-payment.ts line 74: applyPayment returns { applied: false, invoice: null }
  // — the invoice row disappeared (e.g. hard-deleted) between the initial findById and the UPDATE.
  it("returns not_found when applyPayment returns invoice=null (row disappeared)", async () => {
    const id = await seedSentInvoice();
    const sentInvoice = await repo.findById(id);
    if (!sentInvoice) throw new Error("setup: invoice not found");

    class DisappearedRepo extends FakeInvoiceRepository {
      override async applyPayment(_invoiceId: InvoiceId, _amountCents: number): Promise<ApplyResult> {
        return { applied: false, invoice: null };
      }
    }

    const goneRepo = new DisappearedRepo();
    await goneRepo.save(sentInvoice);

    const gateway = new CountingManualGateway(clock);
    const goneBus = new InMemoryEventBus();
    const uc = new RecordPaymentUseCase(goneRepo, gateway, goneBus, clock, seqIds());
    const r = await uc.exec({
      orgId: ORG,
      invoiceId: id,
      amount: money(5_000),
      method: "cash",
      idempotencyKey: "pay-key-gone1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
    expect(goneBus.recorded.some((e) => e.name === "invoice.payment.recorded")).toBe(false);
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
