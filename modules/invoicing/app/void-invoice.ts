import type { InvoiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface VoidInvoiceCommand {
  readonly invoiceId: InvoiceId;
}

export class VoidInvoiceUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: VoidInvoiceCommand): Promise<Result<Invoice, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    const voided = invoice.void(this.clock.now());
    if (!isOk(voided)) return voided;
    if (voided.value === invoice) return ok(invoice); // already void

    await this.repo.save(voided.value);
    await this.bus.emit({
      name: "invoice.voided",
      orgId: voided.value.props.orgId,
      payload: { invoiceId: voided.value.props.id, leadId: voided.value.props.leadId },
      occurredAt: this.clock.now(),
    });
    return ok(voided.value);
  }
}
