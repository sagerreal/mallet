import type { Result, AppError } from "@mallet/shared/types";
import { ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { OutboxEvent, OutboxHandler, RelayHandlerContext } from "@mallet/shared/outbox";
import type { QboAccess } from "../domain/qbo-api-gateway";
import type { SyncableInvoice } from "../domain/invoice-mapping";
import type { SyncableCustomer } from "../domain/customer-mapping";
import type { SyncInvoiceResult } from "./sync-invoice";

/** What the handler needs from the wider app, injected so this file stays free of adapters. */
export interface QboInvoiceSyncPorts {
  /** The org's connection settings, or null when QuickBooks isn't connected. */
  readonly loadSyncConfig: (
    ctx: RelayHandlerContext,
  ) => Promise<{ enabled: boolean; invoiceItemQboId: string | null } | null>;
  readonly access: (ctx: RelayHandlerContext) => Promise<Result<QboAccess, AppError>>;
  /** The invoice and its customer, or null when either has since gone. */
  readonly load: (
    ctx: RelayHandlerContext,
    invoiceId: string,
  ) => Promise<{ invoice: SyncableInvoice; customer: SyncableCustomer } | null>;
  readonly sync: (
    ctx: RelayHandlerContext,
    invoice: SyncableInvoice,
    customer: SyncableCustomer,
    invoiceItemQboId: string | null,
    access: QboAccess,
  ) => Promise<Result<SyncInvoiceResult, AppError>>;
}

/**
 * Puts a SENT invoice into QuickBooks.
 *
 * Registered for "invoice.sent", not "invoice.created": a draft is not a financial fact, and
 * pushing drafts would put unissued revenue in a shop's books.
 *
 * Disposition contract (see shared/outbox/relay): returning a RETRYABLE external_service error
 * leaves the event unpublished for the next tick; anything else is terminal. That mapping is the
 * whole safety of this handler — a QuickBooks outage should retry, but a shop that has not turned
 * invoice sync on must not spin forever.
 *
 * The relay is at-least-once, so this runs more than once for the same invoice whenever a tick is
 * interrupted. The duplicate guard lives in SyncInvoice (the qbo_sync_log unique index), not here.
 */
export class QboInvoiceSyncHandler implements OutboxHandler {
  constructor(private readonly ports: QboInvoiceSyncPorts) {}

  async handle(event: OutboxEvent, ctx: RelayHandlerContext): Promise<Result<void, AppError>> {
    const invoiceId = typeof event.payload.invoiceId === "string" ? event.payload.invoiceId : "";
    if (!invoiceId) {
      // A malformed event will never become valid — terminal, not retried.
      logger.warn({ orgId: ctx.orgId }, "qbo.invoice.event_missing_id");
      return ok(undefined);
    }

    const config = await this.ports.loadSyncConfig(ctx);
    // Not connected, or the shop hasn't switched invoices on. Both are ordinary states, not
    // failures — connecting QuickBooks must never silently start writing to someone's books.
    if (!config || !config.enabled) return ok(undefined);

    const access = await this.ports.access(ctx);
    if (!access.ok) {
      const retryable = access.error.kind === "external_service" && access.error.retryable;
      if (!retryable) {
        logger.warn({ orgId: ctx.orgId, kind: access.error.kind }, "qbo.invoice.no_access_terminal");
        return ok(undefined);
      }
      return err(access.error);
    }

    const loaded = await this.ports.load(ctx, invoiceId);
    // Deleted since it was sent. Nothing to push and nothing to fix — terminal.
    if (!loaded) {
      logger.warn({ orgId: ctx.orgId, invoiceId }, "qbo.invoice.gone");
      return ok(undefined);
    }

    const result = await this.ports.sync(
      ctx,
      loaded.invoice,
      loaded.customer,
      config.invoiceItemQboId,
      access.value,
    );
    if (!result.ok) {
      if (result.error.kind === "external_service" && result.error.retryable) {
        return err(result.error);
      }
      // Refusals are already recorded in the sync log with actionable codes, and re-running would
      // not fix them — the shop has to act. Don't spin the relay on it.
      logger.warn({ orgId: ctx.orgId, invoiceId, kind: result.error.kind }, "qbo.invoice.terminal_failure");
      return ok(undefined);
    }

    return ok(undefined);
  }
}
