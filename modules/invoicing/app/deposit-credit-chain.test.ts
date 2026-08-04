/**
 * The whole money chain for a quote deposit, end to end, with fakes standing in for the DB:
 *
 *   accepted quote (deposit is an ASK, depPaid 0)
 *     → customer pays it → RecordEstimateDepositUseCase writes estimates.dep_paid_cents
 *       → the job runs and completes
 *         → CreateInvoiceFromJobUseCase credits that deposit via EstimateDepositReader
 *           → the bill asks for total − deposit
 *
 * Each link is covered on its own elsewhere; this exists because the LINKS are what broke before.
 * Task 4 removed a fake deposit that made this chain lie (every accepted quote credited an invoice
 * with money nobody had collected), and Task 2 wired the reader. If either regresses, the numbers
 * here stop matching even though every individual unit test still passes.
 *
 * Deliberately unit-level (fakes, no DB): the live-DB proof of the same chain is
 * modules/quoting/api/estimate-router.int.test.ts, which runs it through the real routers.
 */
import { describe, it, expect } from "vitest";
import {
  asOrgId,
  asJobId,
  asLeadId,
  asEstimateId,
  asInvoiceId,
  FixedClock,
  isOk,
  type JobId,
  type InvoiceId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { RecordEstimateDepositUseCase } from "@/modules/quoting/app/record-estimate-deposit";
import {
  ORG,
  EST,
  acceptedEstimate,
  fieldAcceptedEstimate,
  estimateLine,
  FakeDepositLedger,
} from "@/modules/quoting/app/quote-deposit.fixtures";
import type { Invoice } from "../domain/invoice";
import type { Payment } from "../domain/payment";
import type { InvoiceRepository, ApplyResult } from "../domain/invoice-repository";
import type { JobReader, JobSummary } from "../domain/job-reader";
import type { EstimateDepositReader } from "../domain/estimate-deposit-reader";
import { CreateInvoiceFromJobUseCase } from "./create-invoice-from-job";

const NOW = new Date("2026-06-05T00:00:00Z");
const JOB: JobId = asJobId("66666666-6666-4666-8666-666666666666");
const INVOICE_ID: InvoiceId = asInvoiceId("77777777-7777-4777-8777-777777777777");

const ids: IdGenerator = { newId: () => "88888888-8888-4888-8888-888888888888" };

/** The completed job that came from the accepted quote — snapshot totals, no priced job lines. */
const completedJob = (): JobSummary => ({
  id: JOB,
  leadId: asLeadId("33333333-3333-4333-8333-333333333333"),
  title: "Repipe",
  status: "complete",
  kind: "work",
  num: "JOB-1",
  sourceEstimateId: asEstimateId(EST),
  lines: [],
  totalCents: 100_000,
  taxBps: 0,
  taxCents: 0,
});

class FakeInvoiceRepo implements InvoiceRepository {
  public stored: Invoice | null = null;
  async nextNumber(): Promise<string> { return "INV-1000"; }
  async save(invoice: Invoice): Promise<void> { this.stored = invoice; }
  async insertForJob(invoice: Invoice): Promise<boolean> { this.stored = invoice; return true; }
  async insertPayment(_o: OrgId, _i: InvoiceId, _p: Payment): Promise<boolean> { return true; }
  async applyPayment(): Promise<ApplyResult> { return { applied: false, invoice: this.stored }; }
  async findById(): Promise<Invoice | null> { return this.stored; }
  async findByPublicToken(): Promise<Invoice | null> { return this.stored; }
  async findBySourceJob(): Promise<Invoice | null> { return null; }
  async list(_p: CursorPage): Promise<Paginated<Invoice>> { return { items: [], nextCursor: null }; }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
  async listByLead(): Promise<Paginated<Invoice>> { return { items: [], nextCursor: null }; }
  async findOverdue(): Promise<Paginated<Invoice>> { return { items: [], nextCursor: null }; }
}

describe("deposit → invoice credit chain", () => {
  /** One shared estimate "row": quoting writes it, invoicing reads it — the seam under test. */
  const chain = () => {
    const store = { estimate: acceptedEstimate() }; // $1,000 total, 30% deposit, depPaid 0
    const recordDeposit = new RecordEstimateDepositUseCase(
      { findById: async () => store.estimate },
      new FakeDepositLedger(store),
      new InMemoryEventBus(),
      new FixedClock(NOW),
    );
    const deposits: EstimateDepositReader = {
      depositPaidCents: async (_orgId, estimateId) =>
        estimateId === store.estimate.props.id ? store.estimate.props.depPaid : 0,
    };
    const jobs: JobReader = { read: async () => completedJob() };
    const repo = new FakeInvoiceRepo();
    const bill = new CreateInvoiceFromJobUseCase(
      repo,
      jobs,
      deposits,
      new InMemoryEventBus(),
      new FixedClock(NOW),
      ids,
    );
    return { store, recordDeposit, bill, repo };
  };

  it("credits the COLLECTED deposit, so the bill asks for total − deposit", async () => {
    const { store, recordDeposit, bill } = chain();

    // 1. Accepted, deposit asked for, nothing paid.
    expect(store.estimate.props.status).toBe("accepted");
    expect(store.estimate.depositDue()).toBe(30_000);
    expect(store.estimate.props.depPaid).toBe(0);

    // 2. The customer pays the deposit.
    const recorded = await recordDeposit.exec({
      orgId: ORG,
      estimateId: EST,
      amountCents: 30_000,
      paymentRef: "pi_deposit_1",
    });
    expect(isOk(recorded) && recorded.value.recorded).toBe(true);
    expect(store.estimate.props.depPaid).toBe(30_000);

    // 3. The job completes and is billed.
    const invoiced = await bill.exec({ orgId: ORG, jobId: JOB, id: INVOICE_ID });
    expect(isOk(invoiced)).toBe(true);
    if (!isOk(invoiced)) return;

    // 4. The invoice nets the deposit out. This is the assertion the whole task exists for.
    expect(invoiced.value.props.total).toBe(100_000);
    expect(invoiced.value.props.depositPaid).toBe(30_000);
    expect(invoiced.value.due()).toBe(70_000);
  });

  it("credits NOTHING when the deposit was never collected — accepting is not paying", async () => {
    const { store, bill } = chain();

    // No deposit recorded: the quote is accepted and the ask stands, but no money landed.
    expect(store.estimate.depositDue()).toBe(30_000);

    const invoiced = await bill.exec({ orgId: ORG, jobId: JOB, id: INVOICE_ID });
    expect(isOk(invoiced)).toBe(true);
    if (!isOk(invoiced)) return;
    expect(invoiced.value.props.depositPaid).toBe(0);
    expect(invoiced.value.due()).toBe(100_000); // the FULL amount is still owed
  });

  it("TWO real payments (the re-signed-on-site double charge) BOTH reach the invoice credit", async () => {
    // The scenario the amount-based guard lost. A field-born quote is signed, the customer starts
    // paying the deposit (session A), the tech re-prices and re-signs on site — resignOnSite
    // REPLACES the line set on an already-accepted quote, so depositDue() moves and a second
    // checkout (session B) exists alongside the first — and both settle.
    //
    // Under `SET`, whichever landed second decided everything: B-then-A recorded nothing at all,
    // A-then-B erased the smaller payment. Either way the customer paid twice and the invoice
    // credited one. With payment identity, both are kept and the bill nets out what was actually
    // collected.
    const store = { estimate: fieldAcceptedEstimate() }; // $1,000, 30% → asks $300
    const ledger = new FakeDepositLedger(store);
    const recordDeposit = new RecordEstimateDepositUseCase(
      { findById: async () => store.estimate },
      ledger,
      new InMemoryEventBus(),
      new FixedClock(NOW),
    );

    // Session A settles: $300 against the original price.
    const sessionA = await recordDeposit.exec({
      orgId: ORG,
      estimateId: EST,
      amountCents: 30_000,
      paymentRef: "pi_session_A",
    });
    expect(isOk(sessionA) && sessionA.value.recorded).toBe(true);

    // The tech re-prices on site: $2,000 of work, so the deposit ask becomes $600.
    const resigned = store.estimate.resignOnSite(
      [estimateLine(200_000)],
      { signerName: "Dana Reyes", signatureSvg: "", signerIp: null, signerUserAgent: null },
      "Bay Plumbing",
      NOW,
    );
    expect(isOk(resigned)).toBe(true);
    if (!isOk(resigned)) return;
    store.estimate = resigned.value;
    expect(store.estimate.depositDue()).toBe(60_000); // the ask moved — hence a second session
    // The deposit already collected survived the re-sign (it lives on the ledger, not on a field
    // any aggregate write can overwrite).
    expect(store.estimate.props.depPaid).toBe(30_000);

    // Session B settles: the customer pays the revised deposit too.
    const sessionB = await recordDeposit.exec({
      orgId: ORG,
      estimateId: EST,
      amountCents: 60_000,
      paymentRef: "pi_session_B",
    });
    expect(isOk(sessionB) && sessionB.value.recorded).toBe(true);

    // TWO ledger rows, and the total is the sum — not the larger, and not nothing.
    expect(ledger.rows).toHaveLength(2);
    expect(store.estimate.props.depPaid).toBe(90_000);

    // And the whole $900 reaches the bill.
    const deposits: EstimateDepositReader = {
      depositPaidCents: async () => store.estimate.props.depPaid,
    };
    const bill = new CreateInvoiceFromJobUseCase(
      new FakeInvoiceRepo(),
      { read: async () => completedJob() },
      deposits,
      new InMemoryEventBus(),
      new FixedClock(NOW),
      ids,
    );
    const invoiced = await bill.exec({ orgId: ORG, jobId: JOB, id: INVOICE_ID });
    expect(isOk(invoiced)).toBe(true);
    if (!isOk(invoiced)) return;
    expect(invoiced.value.props.depositPaid).toBe(90_000);
    expect(invoiced.value.due()).toBe(10_000); // $1,000 billed − $900 collected
  });

  it("a duplicate delivery of the same deposit does not double-credit the invoice", async () => {
    const { recordDeposit, bill } = chain();

    // Same payment_ref both times — the webhook and the reconcile delivering one payment.
    const one = { orgId: ORG, estimateId: EST, amountCents: 30_000, paymentRef: "pi_deposit_1" };
    await recordDeposit.exec(one);
    await recordDeposit.exec(one);

    const invoiced = await bill.exec({ orgId: asOrgId(ORG), jobId: JOB, id: INVOICE_ID });
    expect(isOk(invoiced)).toBe(true);
    if (!isOk(invoiced)) return;
    expect(invoiced.value.props.depositPaid).toBe(30_000);
    expect(invoiced.value.due()).toBe(70_000);
  });
});
