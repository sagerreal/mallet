import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import { toQboPayment, type SyncablePayment } from "../domain/payment-mapping";
import type { SyncableCustomer } from "../domain/customer-mapping";
import type { EnsureQboCustomer } from "./ensure-qbo-customer";

const ENTITY = "payment";
const INVOICE = "invoice";

export interface SyncPaymentCommand {
  readonly payment: SyncablePayment;
  readonly customer: SyncableCustomer;
}

export interface SyncPaymentResult {
  readonly qboId: string;
  readonly alreadySent: boolean;
}

/**
 * Push one recorded payment to QuickBooks, applied against its invoice.
 *
 * This is what closes the loop. Without it every synced invoice sits unpaid in QuickBooks forever:
 * receivables climb with money the shop has already banked, and reconciling the statement against
 * the ledger stops working.
 *
 * Deduped on the PAYMENT's own id, not the invoice's — two identical part-payments on one invoice
 * are ordinary, and collapsing them would lose real money from the books.
 */
export class SyncPayment {
  constructor(
    private readonly api: QboApiGateway,
    private readonly customers: EnsureQboCustomer,
    private readonly links: QboEntityLinkRepository,
    private readonly syncLog: QboSyncLogRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: SyncPaymentCommand,
    access: QboAccess,
    orgId: string,
  ): Promise<Result<SyncPaymentResult, AppError>> {
    const paymentId = cmd.payment.id;

    const already = await this.syncLog.succeededIds(ENTITY, [paymentId]);
    if (already.has(paymentId)) {
      const link = await this.links.find(ENTITY, paymentId);
      logger.info({ orgId, paymentId }, "qbo.payment.already_sent");
      return ok({ qboId: link?.qboId ?? "", alreadySent: true });
    }

    // The invoice must already be in QuickBooks. A payment with no LinkedTxn is filed as an
    // unapplied credit — the money appears, the invoice still reads open, and somebody reconciles
    // it by hand later. Refusing is the honest answer.
    const invoiceLink = await this.links.find(INVOICE, cmd.payment.invoiceId);
    const dryRun = toQboPayment(cmd.payment, "pending", invoiceLink?.qboId ?? null);
    if (!dryRun.ok) {
      await this.record(paymentId, null, "failed", dryRun.error.field ?? "unmappable", dryRun.error.message);
      return err(dryRun.error);
    }

    const customer = await this.customers.exec(cmd.customer, access, orgId);
    if (!isOk(customer)) {
      await this.record(paymentId, null, "failed", customer.error.kind, `customer not ready: ${customer.error.message}`);
      return err(customer.error);
    }

    const mapped = toQboPayment(cmd.payment, customer.value.qboId, invoiceLink?.qboId ?? null);
    if (!mapped.ok) {
      await this.record(paymentId, null, "failed", mapped.error.field ?? "unmappable", mapped.error.message);
      return err(mapped.error);
    }

    const created = await this.api.createPayment(access, mapped.value);
    if (!created.ok) {
      await this.record(paymentId, null, "failed", created.error.kind, created.error.message);
      return err(created.error);
    }

    await this.links.save({
      entityType: ENTITY,
      malletId: paymentId,
      qboId: created.value.id,
      qboEntityKind: null,
      displayName: null,
    });
    await this.record(paymentId, created.value.id, "succeeded", null, null);
    logger.info({ orgId, paymentId, qboId: created.value.id }, "qbo.payment.sent");
    return ok({ qboId: created.value.id, alreadySent: false });
  }

  private record(
    malletId: string,
    qboId: string | null,
    status: "succeeded" | "failed",
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    return this.syncLog.record({
      entityType: ENTITY,
      malletId,
      qboId,
      status,
      errorCode,
      errorMessage,
      attemptedAt: this.clock.now(),
    });
  }
}
