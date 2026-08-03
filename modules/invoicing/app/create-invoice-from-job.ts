import type { OrgId, JobId, Money, Result, AppError, Clock } from "@mallet/shared/types";
import { asInvoiceId, money, zeroMoney, notFound, conflict, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { JobReader, JobLineSummary } from "../domain/job-reader";
import type { EstimateDepositReader } from "../domain/estimate-deposit-reader";

const DEFAULT_TERMS_DAYS = 7;
const BPS_DENOMINATOR = 10_000;

export interface CreateInvoiceFromJobCommand {
  readonly orgId: OrgId;
  readonly jobId: JobId;
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
    // stale (even 0) and the total must come from the lines: subtotal is pre-tax, the split is
    // computed on top of it and recorded so documents and QuickBooks can itemise.
    const subtotal = lines.reduce((sum, line) => sum + line.amount(), 0);
    const taxFromLines = money(Math.round((subtotal * job.taxBps) / BPS_DENOMINATOR));
    const totals =
      lines.length > 0
        ? { total: money(subtotal + taxFromLines), tax: taxFromLines }
        : {
            // Carried, not recomputed. The tax is already inside the snapshot total; recording the
            // split lets the document itemise it and QuickBooks separate revenue from tax liability.
            total: job.totalCents > 0 ? money(job.totalCents) : zeroMoney,
            tax: job.taxCents > 0 ? money(job.taxCents) : zeroMoney,
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
      id: asInvoiceId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      sourceJobId: cmd.jobId,
      leadId: job.leadId,
      title: job.title,
      status: "draft",
      total: totals.total,
      taxBps: job.taxBps,
      tax: totals.tax,
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
        position: source.position,
      });
      if (!isOk(line)) return line;
      lines.push(line.value);
    }
    return ok(lines);
  }
}
