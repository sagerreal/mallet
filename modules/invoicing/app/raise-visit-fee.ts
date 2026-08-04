import type { OrgId, JobId, InvoiceId, Result, AppError } from "@mallet/shared/types";
import { conflict, notFound, ok, err } from "@mallet/shared/types";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { JobReader } from "../domain/job-reader";
import type { VisitFeeReader } from "../domain/visit-fee-reader";
import { DraftInvoiceUseCase } from "./draft-invoice";

/**
 * The single sentinel that names a visit-fee invoice.
 *
 * Also the client's guard against collecting twice (`features/invoices/visit-fee.ts` holds the
 * same string). Exported from the module barrel so the two can be made one constant rather than
 * two that agree today.
 */
export const VISIT_FEE_TITLE = "Visit fee — service call";

export interface RaiseVisitFeeCommand {
  readonly orgId: OrgId;
  readonly jobId: JobId;
  /** Client-authored id for the NEW row (store id === server id). The idempotent path ignores it. */
  readonly id?: InvoiceId;
}

/**
 * Raise the shop's trip fee on a scoping visit the customer declined.
 *
 * The shape of this is forced by a constraint worth restating: the fee invoice is LEAD-tied
 * (`sourceJobId: null`) on purpose. `invoices_org_source_job_uidx` allows one active invoice per
 * job, and the customer may still accept a quote on this same job next week — a job-tied fee
 * would claim that slot forever and `createFromJob` would hand back the $89 fee draft as the
 * job's bill for the rest of time. So the job is recorded as `scopeJobId` instead, which carries
 * no uniqueness and exists only so the technician standing at the door can be authorized to
 * collect it.
 *
 * IDEMPOTENT ON THE JOB. The previous (client-side) fee flow had no server-side idempotency at
 * all: `draft` dedupes on nothing, so N flaky retries minted N independently-sendable "Visit fee"
 * drafts in the shop's ledger — a live duplicate-charge risk. Re-raising now returns the existing
 * fee invoice, whatever state it is in.
 *
 * THE AMOUNT IS NEVER AN ARGUMENT. It comes from the shop's own configuration, so the person
 * holding the tablet cannot choose what the customer is charged.
 */
export class RaiseVisitFeeUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly jobs: JobReader,
    private readonly fees: VisitFeeReader,
    private readonly draft: DraftInvoiceUseCase,
  ) {}

  async exec(cmd: RaiseVisitFeeCommand): Promise<Result<Invoice, AppError>> {
    const job = await this.jobs.read(cmd.jobId);
    if (!job) return err(notFound("job"));
    // The same gate every close-out write uses, and the same one CreateInvoiceFromJobUseCase
    // applies: a fee is charged for a visit that HAPPENED.
    if (job.status !== "complete") {
      return err(conflict("finish the visit before charging the fee"));
    }

    const existing = await this.findExistingFee(cmd.jobId);
    if (existing) return ok(existing);

    const feeCents = await this.fees.readCents();
    if (feeCents <= 0) {
      return err(
        conflict("this shop hasn't set a visit fee — add one in Settings before charging it"),
      );
    }

    return this.draft.exec({
      orgId: cmd.orgId,
      id: cmd.id,
      leadId: job.leadId,
      title: VISIT_FEE_TITLE,
      termsDays: 0, // collected at the door, not on terms
      scopeJobId: cmd.jobId,
      lines: [{ description: VISIT_FEE_TITLE, quantity: 1, rateCents: feeCents, costCents: 0 }],
    });
  }

  /**
   * This job's fee invoice, if one was already raised.
   *
   * Keyed on the scope link (durable, server-stamped) rather than on the title alone, which is the
   * only signal the client-side flow had. A voided fee is not "already raised" — the shop decided
   * not to charge it, and a genuine second attempt must be able to proceed.
   */
  private async findExistingFee(jobId: JobId): Promise<Invoice | null> {
    const scoped = await this.repo.listByScopeJob(jobId);
    return (
      scoped.find((i) => i.props.title === VISIT_FEE_TITLE && i.props.status !== "void") ?? null
    );
  }
}
