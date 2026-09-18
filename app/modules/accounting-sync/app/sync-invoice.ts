import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import { toQboInvoice, type SyncableInvoice } from "../domain/invoice-mapping";
import type { SyncableCustomer } from "../domain/customer-mapping";
import type { EnsureQboCustomer } from "./ensure-qbo-customer";

const ENTITY = "invoice";

export interface SyncInvoiceCommand {
  readonly invoice: SyncableInvoice;
  readonly customer: SyncableCustomer;
  readonly invoiceItemQboId: string | null;
}

export interface SyncInvoiceResult {
  readonly qboId: string;
  /** True when this invoice was already in QuickBooks and nothing was sent. */
  readonly alreadySent: boolean;
}

/**
 * Push one sent invoice to QuickBooks.
 *
 * **Must be safe to run twice.** The outbox relay is at-least-once — claim, dispatch and mark are
 * separate transactions — so a redelivery is normal rather than exceptional. A duplicate here is
 * not cosmetic: it is a second invoice in a shop's books, inflating revenue and their tax
 * liability, on a document a customer will only ever pay once. The guard is the `qbo_sync_log`
 * partial unique index on succeeded rows, consulted before anything is sent.
 *
 * The customer is ensured first, and a failure there aborts: an invoice cannot be filed without a
 * CustomerRef, and creating one against the wrong customer is the worst outcome in this module.
 */
export class SyncInvoice {
  constructor(
    private readonly api: QboApiGateway,
    private readonly customers: EnsureQboCustomer,
    private readonly links: QboEntityLinkRepository,
    private readonly syncLog: QboSyncLogRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: SyncInvoiceCommand,
    access: QboAccess,
    orgId: string,
  ): Promise<Result<SyncInvoiceResult, AppError>> {
    const invoiceId = cmd.invoice.id;

    // Idempotency gate, before any work: an already-pushed invoice must not be pushed again.
    const alreadySent = await this.syncLog.succeededIds(ENTITY, [invoiceId]);
    if (alreadySent.has(invoiceId)) {
      const link = await this.links.find(ENTITY, invoiceId);
      logger.info({ orgId, invoiceId }, "qbo.invoice.already_sent");
      return ok({ qboId: link?.qboId ?? "", alreadySent: true });
    }

    // Map BEFORE ensuring the customer. A refusal we can see locally — no amount, no item chosen —
    // should not first create a customer record in someone's QuickBooks as a side effect.
    const dryRun = toQboInvoice(cmd.invoice, "pending", cmd.invoiceItemQboId);
    if (!dryRun.ok) {
      await this.record(invoiceId, null, "failed", dryRun.error.field ?? "unmappable", dryRun.error.message);
      return err(dryRun.error);
    }

    const customer = await this.customers.exec(cmd.customer, access, orgId);
    if (!isOk(customer)) {
      // EnsureQboCustomer has already logged its own reason against the customer; this row says the
      // invoice did not go, so the screen does not simply fall silent about it.
      await this.record(invoiceId, null, "failed", customer.error.kind, `customer not ready: ${customer.error.message}`);
      return err(customer.error);
    }

    const mapped = toQboInvoice(cmd.invoice, customer.value.qboId, cmd.invoiceItemQboId);
    if (!mapped.ok) {
      await this.record(invoiceId, null, "failed", mapped.error.field ?? "unmappable", mapped.error.message);
      return err(mapped.error);
    }

    const created = await this.api.createInvoice(access, mapped.value);
    if (!created.ok) {
      await this.record(invoiceId, null, "failed", created.error.kind, created.error.message);
      return err(created.error);
    }

    // Written immediately after the create, so a crash between the two costs at most ONE duplicate
    // on retry rather than an unbounded number.
    await this.links.save({
      entityType: ENTITY,
      malletId: invoiceId,
      qboId: created.value.id,
      qboEntityKind: null,
      displayName: cmd.invoice.num,
    });
    await this.record(invoiceId, created.value.id, "succeeded", null, null);
    logger.info({ orgId, invoiceId, qboId: created.value.id }, "qbo.invoice.sent");
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
