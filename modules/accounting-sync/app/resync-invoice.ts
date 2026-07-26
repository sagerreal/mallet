import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk, validation } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import { toQboInvoice, type SyncableInvoice } from "../domain/invoice-mapping";

const ENTITY = "invoice";

/** The invoice is in QuickBooks but its customer link has gone — a hand edit, not a Mallet state. */
export const CUSTOMER_NOT_LINKED = "customer_not_linked";
export const GONE_FROM_QBO = "gone_from_quickbooks";

export type ResyncOutcome = "updated" | "voided" | "not_synced" | "gone_from_quickbooks";

export interface ResyncInvoiceResult {
  readonly outcome: ResyncOutcome;
}

/**
 * Carry a change made in Mallet through to an invoice already in QuickBooks — an edit, or a void.
 *
 * Without this the books quietly hold a different number than the invoice does: a price corrected
 * after sending, or an invoice voided in Mallet, would leave QuickBooks showing the original as
 * live and payable. That is exactly the divergence this whole integration exists to prevent.
 *
 * **An invoice that was never synced is a no-op, not a failure.** It is the ordinary case — the
 * shop had invoice sync switched off when it was sent, or edited a draft. There is nothing in
 * QuickBooks to correct, and reporting a failure would fill the activity screen with rows nobody
 * can act on.
 *
 * **SyncToken is read immediately before every write.** QuickBooks uses it for optimistic
 * concurrency and refuses a stale one, so it cannot be cached — a change made inside QuickBooks
 * between our read and our write would invalidate it, and that refusal is the point: it stops us
 * silently overwriting an edit a bookkeeper made by hand.
 */
export class ResyncInvoice {
  constructor(
    private readonly api: QboApiGateway,
    private readonly links: QboEntityLinkRepository,
    private readonly syncLog: QboSyncLogRepository,
    private readonly clock: Clock,
  ) {}

  async update(
    invoice: SyncableInvoice,
    customerQboId: string | null,
    invoiceItemQboId: string | null,
    access: QboAccess,
    orgId: string,
  ): Promise<Result<ResyncInvoiceResult, AppError>> {
    const link = await this.links.find(ENTITY, invoice.id);
    if (!link) return ok({ outcome: "not_synced" });

    if (!customerQboId) {
      // The invoice is in QuickBooks, so its customer must be too — this means the link was removed
      // by hand. Refuse rather than re-point the invoice at a customer we would have to guess at,
      // and check it BEFORE mapping so the refusal names the real cause.
      const problem = validation(
        "this invoice's customer is no longer matched in QuickBooks",
        CUSTOMER_NOT_LINKED,
      );
      await this.record(invoice.id, link.qboId, CUSTOMER_NOT_LINKED, problem.message);
      return err(problem);
    }

    const mapped = toQboInvoice(invoice, customerQboId, invoiceItemQboId);
    if (!mapped.ok) {
      await this.record(invoice.id, link.qboId, mapped.error.field ?? "unmappable", mapped.error.message);
      return err(mapped.error);
    }

    const token = await this.api.readInvoiceToken(access, link.qboId);
    if (!isOk(token)) return await this.fail(invoice.id, link.qboId, token.error);
    if (token.value === null) {
      // Deleted inside QuickBooks. Recreating it would resurrect something a bookkeeper removed on
      // purpose, so say so and stop.
      await this.record(invoice.id, link.qboId, GONE_FROM_QBO, "this invoice was removed inside QuickBooks");
      return ok({ outcome: "gone_from_quickbooks" });
    }

    const updated = await this.api.updateInvoice(access, link.qboId, token.value, mapped.value);
    if (!isOk(updated)) return await this.fail(invoice.id, link.qboId, updated.error);

    logger.info({ orgId, invoiceId: invoice.id, qboId: link.qboId }, "qbo.invoice.updated");
    return ok({ outcome: "updated" });
  }

  async void(
    invoiceId: string,
    access: QboAccess,
    orgId: string,
  ): Promise<Result<ResyncInvoiceResult, AppError>> {
    const link = await this.links.find(ENTITY, invoiceId);
    if (!link) return ok({ outcome: "not_synced" });

    const token = await this.api.readInvoiceToken(access, link.qboId);
    if (!isOk(token)) return await this.fail(invoiceId, link.qboId, token.error);
    if (token.value === null) {
      // Already gone from QuickBooks — the desired end state, reached another way.
      logger.info({ orgId, invoiceId }, "qbo.invoice.void_already_gone");
      return ok({ outcome: "gone_from_quickbooks" });
    }

    const voided = await this.api.voidInvoice(access, link.qboId, token.value);
    if (!isOk(voided)) {
      // The commonest refusal is a payment applied against it: QuickBooks will not void an invoice
      // that money is attached to. That needs a person, so it is logged with its own reason rather
      // than retried into a wall.
      return await this.fail(invoiceId, link.qboId, voided.error);
    }

    logger.info({ orgId, invoiceId, qboId: link.qboId }, "qbo.invoice.voided");
    return ok({ outcome: "voided" });
  }

  private async fail(
    malletId: string,
    qboId: string,
    error: AppError,
  ): Promise<Result<ResyncInvoiceResult, AppError>> {
    await this.record(malletId, qboId, error.kind, error.message);
    return err(error);
  }

  private record(
    malletId: string,
    qboId: string | null,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    return this.syncLog.record({
      entityType: ENTITY,
      malletId,
      qboId,
      // NOT "succeeded" even when the outcome is benign: the partial unique index reserves that for
      // the original push, and a second succeeded row for the same invoice would violate it.
      status: "failed",
      errorCode,
      errorMessage,
      attemptedAt: this.clock.now(),
    });
  }
}
