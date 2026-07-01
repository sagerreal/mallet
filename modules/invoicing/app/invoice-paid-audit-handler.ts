import { asInvoiceId, ok, type Result, type AppError } from "@mallet/shared/types";
import type { OutboxEvent, OutboxHandler, RelayHandlerContext } from "@mallet/shared/outbox";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";

// The one relay handler shipped in the pilot — internal, side-effect-free, NO external call. It
// exists to exercise the relay path end-to-end (owner claim -> withTenant dispatch -> mark) under
// live RLS. There is no projection to fill: invoice.paid is emitted AFTER applyPayment already set
// status='paid' in the same tenant tx. The handler re-reads the invoice through the tenant-scoped
// repo (proving withTenant dispatch scopes to the right org) and returns ok. A pure read is
// trivially idempotent, so at-least-once redelivery is safe.
export class InvoicePaidAuditHandler implements OutboxHandler {
  async handle(event: OutboxEvent, ctx: RelayHandlerContext): Promise<Result<void, AppError>> {
    const invoiceId = event.payload.invoiceId;
    if (typeof invoiceId === "string") {
      const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.orgId);
      await repo.findById(asInvoiceId(invoiceId));
    }
    return ok(undefined);
  }
}
