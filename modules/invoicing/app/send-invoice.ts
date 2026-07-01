import type { InvoiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus } from "@mallet/shared/ports";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface SendInvoiceCommand {
  readonly invoiceId: InvoiceId;
}

// draft -> sent, stamping the due date. Emits invoice.sent carrying dueAt so a future reminder job
// can schedule (no scheduler in the pilot).
export class SendInvoiceUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SendInvoiceCommand): Promise<Result<Invoice, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    const sent = invoice.send(this.clock.now());
    if (!isOk(sent)) return sent;
    if (sent.value === invoice) return ok(invoice); // idempotent no-op

    await this.repo.save(sent.value);
    await this.bus.emit({
      name: "invoice.sent",
      orgId: sent.value.props.orgId,
      payload: {
        invoiceId: sent.value.props.id,
        leadId: sent.value.props.leadId,
        dueAt: sent.value.props.dueAt?.toISOString() ?? null,
      },
      occurredAt: this.clock.now(),
    });
    return ok(sent.value);
  }
}
