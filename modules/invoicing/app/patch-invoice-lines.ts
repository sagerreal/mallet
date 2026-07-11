import type { InvoiceId, Result, AppError, Clock } from "@mallet/shared/types";
import { money, notFound, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Invoice } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { InvoiceLineInput } from "./draft-invoice";

export interface PatchInvoiceLinesCommand {
  readonly invoiceId: InvoiceId;
  readonly lines: readonly InvoiceLineInput[];
}

// Replace an open invoice's display lines with the full supplied set and recompute the total.
// Lines get fresh server ids + sequential positions; save()'s diffLines soft-deletes dropped rows.
export class PatchInvoiceLinesUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: PatchInvoiceLinesCommand): Promise<Result<Invoice, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));

    const built: InvoiceLine[] = [];
    for (let i = 0; i < cmd.lines.length; i += 1) {
      const input = cmd.lines[i];
      if (!input) continue;
      const line = InvoiceLine.create({
        id: this.ids.newId(),
        sourceJobLineId: null,
        description: input.description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        position: i,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }

    const now = this.clock.now();
    const patched = invoice.editLines(built, now);
    if (!isOk(patched)) return patched;

    await this.repo.save(patched.value);
    logger.info(
      { invoiceId: patched.value.props.id, orgId: patched.value.props.orgId },
      "invoice.lines.patched",
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
