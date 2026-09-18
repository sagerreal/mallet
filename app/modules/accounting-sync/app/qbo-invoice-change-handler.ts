import type { Result, AppError } from "@mallet/shared/types";
import { ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { OutboxEvent, OutboxHandler, RelayHandlerContext } from "@mallet/shared/outbox";
import type { QboAccess } from "../domain/qbo-api-gateway";
import type { SyncableInvoice } from "../domain/invoice-mapping";
import type { ResyncInvoiceResult } from "./resync-invoice";

export interface QboInvoiceChangePorts {
  readonly loadSyncConfig: (
    ctx: RelayHandlerContext,
  ) => Promise<{ enabled: boolean; invoiceItemQboId: string | null } | null>;
  readonly access: (ctx: RelayHandlerContext) => Promise<Result<QboAccess, AppError>>;
  /** The invoice as Mallet now holds it, plus its customer's QuickBooks id if it has one. */
  readonly load: (
    ctx: RelayHandlerContext,
    invoiceId: string,
  ) => Promise<{ invoice: SyncableInvoice; customerQboId: string | null } | null>;
  readonly update: (
    ctx: RelayHandlerContext,
    invoice: SyncableInvoice,
    customerQboId: string | null,
    invoiceItemQboId: string | null,
    access: QboAccess,
  ) => Promise<Result<ResyncInvoiceResult, AppError>>;
  readonly void: (
    ctx: RelayHandlerContext,
    invoiceId: string,
    access: QboAccess,
  ) => Promise<Result<ResyncInvoiceResult, AppError>>;
}

/**
 * Carries an edit or a void through to an invoice already in QuickBooks.
 *
 * Registered for BOTH "invoice.updated" and "invoice.voided" — one handler, because the two share
 * every step except the final call, and splitting them would duplicate the config, token and
 * disposition logic that is the actual substance.
 *
 * An invoice that was never synced is a silent no-op. That is the ordinary case, not a fault: the
 * shop may have had invoice sync switched off when it was sent, or be editing a draft.
 */
export class QboInvoiceChangeHandler implements OutboxHandler {
  constructor(
    private readonly ports: QboInvoiceChangePorts,
    private readonly action: "update" | "void",
  ) {}

  async handle(event: OutboxEvent, ctx: RelayHandlerContext): Promise<Result<void, AppError>> {
    const invoiceId = typeof event.payload.invoiceId === "string" ? event.payload.invoiceId : "";
    if (!invoiceId) {
      logger.warn({ orgId: ctx.orgId }, "qbo.invoice_change.event_missing_id");
      return ok(undefined);
    }

    const config = await this.ports.loadSyncConfig(ctx);
    if (!config || !config.enabled) return ok(undefined);

    const access = await this.ports.access(ctx);
    if (!access.ok) {
      const retryable = access.error.kind === "external_service" && access.error.retryable;
      if (!retryable) {
        logger.warn({ orgId: ctx.orgId, kind: access.error.kind }, "qbo.invoice_change.no_access_terminal");
        return ok(undefined);
      }
      return err(access.error);
    }

    const result =
      this.action === "void"
        ? await this.ports.void(ctx, invoiceId, access.value)
        : await this.updatePath(ctx, invoiceId, config.invoiceItemQboId, access.value);

    if (!result.ok) {
      if (result.error.kind === "external_service" && result.error.retryable) {
        return err(result.error);
      }
      logger.warn(
        { orgId: ctx.orgId, invoiceId, kind: result.error.kind },
        "qbo.invoice_change.terminal_failure",
      );
      return ok(undefined);
    }

    return ok(undefined);
  }

  private async updatePath(
    ctx: RelayHandlerContext,
    invoiceId: string,
    invoiceItemQboId: string | null,
    access: QboAccess,
  ): Promise<Result<ResyncInvoiceResult, AppError>> {
    const loaded = await this.ports.load(ctx, invoiceId);
    // Deleted since the edit. Nothing to carry over and nothing to fix.
    if (!loaded) return ok({ outcome: "not_synced" });
    return this.ports.update(ctx, loaded.invoice, loaded.customerQboId, invoiceItemQboId, access);
  }
}
