import type { OrgId, JobId, InvoiceId, Money, Result, AppError, Clock } from "@mallet/shared/types";
import { asInvoiceId, money, zeroMoney, notFound, conflict, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Invoice, BPS_DENOMINATOR } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { JobReader, JobLineSummary } from "../domain/job-reader";
import type { EstimateDepositReader } from "../domain/estimate-deposit-reader";

const DEFAULT_TERMS_DAYS = 7;

export interface CreateInvoiceFromJobCommand {
  readonly orgId: OrgId;
  readonly jobId: JobId;
  // Client-authored id (the store needs a stable id synchronously); preserved so the store's
  // local id === the server row id — mirrors DraftInvoiceUseCase. Applies to the NEW row only:
  // the idempotent path (job already invoiced) returns the existing row and ignores this.
  readonly id?: InvoiceId;
}

// Bill a completed job. Idempotent: one invoice per job. When the job carries priced lines they
// ARE the bill: they are copied onto the invoice (sourceJobLineId set) and the total is derived
// from them — Σ(qty×rate) + round(Σ × taxBps/10000) — because the job's total_cents is a
// creation-time snapshot the on-site sign path never updates. A job without priced lines keeps the
// snapshot fallback (total + tax split carried from the accepted estimate, TAX INCLUSIVE). Either
// way, a deposit already paid on the source estimate is credited so the bill asks only for what is
// still owed.
export class CreateInvoiceFromJobUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly jobs: JobReader,
    private readonly deposits: EstimateDepositReader,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateInvoiceFromJobCommand): Promise<Result<Invoice, AppError>> {
    const job = await this.jobs.read(cmd.jobId);
    if (!job) return err(notFound("job"));
    if (job.status !== "complete") {
      return err(conflict("job must be complete before it can be invoiced"));
    }
    // An unpriced ESTIMATE is a scoping visit — there is nothing to bill, and minting a $0
    // draft only buries real receivables. Signed-on-site estimates carry priced job lines
    // (hasPricedLines) and office-accepted ones carry totalCents; both stay invoiceable.
    const pricedLines = job.lines.filter((l) => l.quantity * l.rateCents > 0);
    if (job.kind === "estimate" && job.totalCents <= 0 && pricedLines.length === 0) {
      return err(conflict("this estimate has no price — quote it before billing"));
    }

    const existing = await this.repo.findBySourceJob(cmd.jobId);
    if (existing) return ok(existing); // idempotent

    const built = this.copyLines(pricedLines);
    if (!isOk(built)) return built;
    const lines = built.value;

    // Priced lines are the bill; the snapshot is the fallback. total_cents is written once at job
    // creation and the on-site sign path never syncs it, so when lines exist the snapshot may be
    // stale (even 0) and the total must come from the lines.
    //
    // THE DISCOUNT IS PART OF THAT DERIVATION, AND OMITTING IT OVERBILLED THE CUSTOMER. Job lines
    // are pre-tax AND pre-discount while job.totalCents is both applied, so rebuilding the bill
    // from lines without re-applying discBps charged the full undiscounted sum. Measured on a live
    // 10% quote: lines $114.98, agreed $112.02, billed $124.47.
    //
    // The chain is discount → net → tax → total, each step rounded to whole cents, mirroring
    // Estimate.totalsFrom (modules/quoting/domain/estimate.ts) exactly. Same order, same rounding,
    // so an invoice rebuilt from lines lands on the number the customer accepted.
    //
    // TAX IS CHARGED ON THE TAXABLE LINES ONLY — a SECOND, DIFFERENT filter from the subtotal.
    // A non-taxable line is still billed at its full rate and still in the total; it simply is
    // not in the base. The discount comes off that base at the same rate it comes off the bill,
    // so on an all-taxable job the base IS the subtotal and every figure is what it was before
    // taxability existed. Same order, same rounding, same result.
    const subtotal = lines.reduce((sum, line) => sum + line.amount(), 0);
    const taxableBase = lines.reduce(
      (sum, line) => (line.props.taxable ? sum + line.amount() : sum),
      0,
    );
    const discountFromLines = money(Math.round((subtotal * job.discBps) / BPS_DENOMINATOR));
    const netFromLines = money(subtotal - discountFromLines);
    const taxableDiscount = money(Math.round((taxableBase * job.discBps) / BPS_DENOMINATOR));
    const taxFromLines = money(
      Math.round(((taxableBase - taxableDiscount) * job.taxBps) / BPS_DENOMINATOR),
    );
    const totals =
      lines.length > 0
        ? {
            total: money(netFromLines + taxFromLines),
            tax: taxFromLines,
            discount: discountFromLines,
          }
        : {
            // Carried, not recomputed. The tax is already inside the snapshot total; recording the
            // split lets the document itemise it and QuickBooks separate revenue from tax liability.
            // No discount is recorded here: the snapshot total already has it applied and the
            // amount that came off is not recoverable from a single figure.
            total: job.totalCents > 0 ? money(job.totalCents) : zeroMoney,
            tax: job.taxCents > 0 ? money(job.taxCents) : zeroMoney,
            discount: zeroMoney,
          };

    // The deposit the customer already paid on the estimate this job came from. Credited so the
    // bill asks only for what is still owed. The reader answers 0 for a missing or soft-deleted
    // estimate; a job created by hand has no source estimate and no deposit to credit.
    const depositPaid: Money = job.sourceEstimateId
      ? money(await this.deposits.depositPaidCents(cmd.orgId, job.sourceEstimateId))
      : zeroMoney;

    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const invoice = Invoice.create({
      id: this.invoiceId(cmd),
      orgId: cmd.orgId,
      num,
      sourceJobId: cmd.jobId,
      leadId: job.leadId,
      title: job.title,
      status: "draft",
      total: totals.total,
      taxBps: job.taxBps,
      tax: totals.tax,
      // Recorded so the document can itemise it. The lines print at their full rates, so a total
      // 10% under their sum with no discount row reads as an arithmetic error to the customer.
      discBps: job.discBps,
      discount: totals.discount,
      depositPaid,
      amountPaid: zeroMoney,
      payments: [],
      lines,
      termsDays: DEFAULT_TERMS_DAYS,
      sentAt: null,
      dueAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(invoice)) return invoice;

    // ON CONFLICT DO NOTHING (does not abort the request tx). Lost the race -> re-fetch the winner.
    const inserted = await this.repo.insertForJob(invoice.value);
    if (!inserted) {
      const raced = await this.repo.findBySourceJob(cmd.jobId);
      if (raced) return ok(raced);
      return err(conflict("an invoice already exists for this job"));
    }

    await this.bus.emit({
      name: "invoice.created",
      orgId: cmd.orgId,
      payload: { invoiceId: invoice.value.props.id, sourceJobId: cmd.jobId, leadId: job.leadId, num },
      occurredAt: now,
    });
    return ok(invoice.value);
  }

  // Client-authored id for the NEW row (store id === server id), else a fresh one.
  private invoiceId(cmd: CreateInvoiceFromJobCommand) {
    return cmd.id ?? asInvoiceId(this.ids.newId());
  }

  // Frozen copies of the job's priced lines, each pointing back at its source via
  // sourceJobLineId — the audit trail from bill line to what the tech recorded on site.
  private copyLines(pricedLines: readonly JobLineSummary[]): Result<InvoiceLine[], AppError> {
    const lines: InvoiceLine[] = [];
    for (const source of pricedLines) {
      const line = InvoiceLine.create({
        id: this.ids.newId(),
        sourceJobLineId: source.id,
        description: source.description,
        quantity: source.quantity,
        rate: money(source.rateCents),
        cost: money(source.costCents),
        // Taxability rides the copy like the rate does — the bill must charge tax on exactly
        // what the quote did.
        taxable: source.taxable,
        position: source.position,
      });
      if (!isOk(line)) return line;
      lines.push(line.value);
    }
    return ok(lines);
  }
}
