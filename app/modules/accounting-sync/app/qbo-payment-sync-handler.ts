import type { Result, AppError } from "@mallet/shared/types";
import { ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { OutboxEvent, OutboxHandler, RelayHandlerContext } from "@mallet/shared/outbox";
import type { QboAccess } from "../domain/qbo-api-gateway";
import type { SyncablePayment } from "../domain/payment-mapping";
import type { SyncableCustomer } from "../domain/customer-mapping";
import type { SyncPaymentResult } from "./sync-payment";

export interface QboPaymentSyncPorts {
  readonly loadSyncConfig: (ctx: RelayHandlerContext) => Promise<{ enabled: boolean } | null>;
  readonly access: (ctx: RelayHandlerContext) => Promise<Result<QboAccess, AppError>>;
  readonly load: (
    ctx: RelayHandlerContext,
    invoiceId: string,
    paymentId: string,
  ) => Promise<{ payment: SyncablePayment; customer: SyncableCustomer } | null>;
  readonly sync: (
    ctx: RelayHandlerContext,
    payment: SyncablePayment,
    customer: SyncableCustomer,
    access: QboAccess,
  ) => Promise<Result<SyncPaymentResult, AppError>>;
}

/**
 * Applies a recorded payment against its QuickBooks invoice.
 *
 * Shares the invoice switch rather than having its own: a shop that sends invoices but not their
 * payments would watch its receivables climb with money it has already banked, which is worse than
 * sending neither. The two are one feature.
 */
export class QboPaymentSyncHandler implements OutboxHandler {
  constructor(private readonly ports: QboPaymentSyncPorts) {}

  async handle(event: OutboxEvent, ctx: RelayHandlerContext): Promise<Result<void, AppError>> {
    const invoiceId = typeof event.payload.invoiceId === "string" ? event.payload.invoiceId : "";
    const paymentId = typeof event.payload.paymentId === "string" ? event.payload.paymentId : "";
    if (!invoiceId || !paymentId) {
      // Older events, emitted before paymentId was carried, land here. Terminal: without the id
      // there is no way to tell this payment from another of the same amount, and guessing would
      // either duplicate money or drop it.
      logger.warn({ orgId: ctx.orgId, invoiceId }, "qbo.payment.event_missing_ids");
      return ok(undefined);
    }

    const config = await this.ports.loadSyncConfig(ctx);
    if (!config || !config.enabled) return ok(undefined);

    const access = await this.ports.access(ctx);
    if (!access.ok) {
      const retryable = access.error.kind === "external_service" && access.error.retryable;
      if (!retryable) {
        logger.warn({ orgId: ctx.orgId, kind: access.error.kind }, "qbo.payment.no_access_terminal");
        return ok(undefined);
      }
      return err(access.error);
    }

    const loaded = await this.ports.load(ctx, invoiceId, paymentId);
    if (!loaded) {
      logger.warn({ orgId: ctx.orgId, paymentId }, "qbo.payment.gone");
      return ok(undefined);
    }

    const result = await this.ports.sync(ctx, loaded.payment, loaded.customer, access.value);
    if (!result.ok) {
      if (result.error.kind === "external_service" && result.error.retryable) {
        return err(result.error);
      }
      // The commonest terminal case is "the invoice isn't in QuickBooks yet" — recorded with an
      // actionable code. Re-running would not change it; the shop has to send the invoice first.
      logger.warn({ orgId: ctx.orgId, paymentId, kind: result.error.kind }, "qbo.payment.terminal_failure");
      return ok(undefined);
    }

    return ok(undefined);
  }
}
