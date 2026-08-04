import type { InvoiceId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import { money, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface UpdateInvoiceMetadataCommand {
  readonly invoiceId: InvoiceId;
  readonly leadId?: LeadId;
  readonly title?: string | null;
  readonly termsDays?: number;
  readonly depositPaidCents?: number;
  /** Customer-supplied PO number. Undefined = keep current; null/blank clears it (see Invoice.editMetadata). */
  readonly poNumber?: string | null;
}

// Edit header metadata on an open (draft|sent|partial) invoice. Frozen once paid/void
// (enforced by Invoice.editMetadata). Emits invoice.updated for audit/relay.
export class UpdateInvoiceMetadataUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: UpdateInvoiceMetadataCommand): Promise<Result<Invoice, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));

    const now = this.clock.now();
    const patched = invoice.editMetadata(
      {
        leadId: cmd.leadId,
        title: cmd.title,
        termsDays: cmd.termsDays,
        depositPaid: cmd.depositPaidCents === undefined ? undefined : money(cmd.depositPaidCents),
        poNumber: cmd.poNumber,
      },
      now,
    );
    if (!isOk(patched)) return patched;

    await this.repo.save(patched.value);
    logger.info(
      { invoiceId: patched.value.props.id, orgId: patched.value.props.orgId },
      "invoice.metadata.updated",
    );
    await this.bus.emit({
      name: "invoice.updated",
      orgId: patched.value.props.orgId,
      payload: { invoiceId: patched.value.props.id, leadId: patched.value.props.leadId },
      occurredAt: now,
    });
    return ok(patched.value);
  }
}
