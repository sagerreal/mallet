import type { OrgId, JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { asInvoiceId, money, zeroMoney, notFound, conflict, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { JobReader } from "../domain/job-reader";

const DEFAULT_TERMS_DAYS = 7;

export interface CreateInvoiceFromJobCommand {
  readonly orgId: OrgId;
  readonly jobId: JobId;
}

// Bill a completed job. Idempotent: one invoice per job. Total is snapshotted from the job (which
// carries the accepted-estimate total); deposit starts at 0 for the pilot (jobs don't yet persist
// a deposit).
export class CreateInvoiceFromJobUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly jobs: JobReader,
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

    const existing = await this.repo.findBySourceJob(cmd.jobId);
    if (existing) return ok(existing); // idempotent

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
      total: job.totalCents > 0 ? money(job.totalCents) : zeroMoney,
      depositPaid: zeroMoney,
      amountPaid: zeroMoney,
      payments: [],
      lines: [],
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
}
