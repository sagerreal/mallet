import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, isOk } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type { QboEntityLinkRepository, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import { toQboCustomer, type SyncableCustomer } from "../domain/customer-mapping";

const ENTITY = "customer";

export interface EnsureQboCustomerResult {
  readonly qboId: string;
  /** How we got here — worth logging, and worth showing when a shop asks why a name was reused. */
  readonly via: "already_linked" | "matched_email" | "matched_name" | "created";
}

/**
 * Get the QuickBooks Customer id for a Mallet customer, creating one only if there is none.
 *
 * Every invoice and every payment needs a `CustomerRef`, so this runs before either — and it is the
 * step where a mistake is worst. Filing an invoice against the wrong customer moves real money onto
 * a stranger's account in a shop's books, and nothing downstream would notice.
 *
 * Hence the ordering, narrowest evidence first:
 *
 *   1. **An existing link.** Already decided; never re-examined. A shop that corrected a match by
 *      hand must not have it silently overridden on the next invoice.
 *   2. **Exact email.** The strongest identity a customer record carries.
 *   3. **Exact DisplayName.** Weaker, but QuickBooks REQUIRES DisplayName to be unique per company,
 *      so creating over an existing one is refused anyway — matching it is the only way through.
 *   4. **Create.**
 *
 * No fuzzy matching at any step, deliberately. "Dave's Plumbing" and "Daves Plumbing LLC" are
 * routinely two different accounts, and a near-match is unrecoverable once money is filed against
 * it — whereas a duplicate customer is a nuisance a bookkeeper can merge in QuickBooks.
 */
export class EnsureQboCustomer {
  constructor(
    private readonly api: QboApiGateway,
    private readonly links: QboEntityLinkRepository,
    private readonly syncLog: QboSyncLogRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    customer: SyncableCustomer,
    access: QboAccess,
    orgId: string,
  ): Promise<Result<EnsureQboCustomerResult, AppError>> {
    const existing = await this.links.find(ENTITY, customer.id);
    if (existing) return ok({ qboId: existing.qboId, via: "already_linked" });

    const mapped = toQboCustomer(customer);
    if (!mapped.ok) {
      await this.record(customer.id, null, "failed", mapped.error.field ?? "unmappable", mapped.error.message);
      return err(mapped.error);
    }
    const input = mapped.value;

    if (input.email) {
      const byEmail = await this.api.findCustomerByEmail(access, input.email);
      if (!isOk(byEmail)) return await this.fail(customer.id, byEmail.error);
      if (byEmail.value) return await this.link(customer.id, byEmail.value.id, byEmail.value.displayName, "matched_email");
    }

    const byName = await this.api.findCustomerByName(access, input.displayName);
    if (!isOk(byName)) return await this.fail(customer.id, byName.error);
    if (byName.value) return await this.link(customer.id, byName.value.id, byName.value.displayName, "matched_name");

    const created = await this.api.createCustomer(access, input);
    if (!isOk(created)) {
      // A name collision here means somebody created that customer between our search and our
      // create — or that QuickBooks matched a name we did not. Re-reading is the honest recovery:
      // the record exists, so link to it rather than reporting a failure the shop cannot act on.
      const raced = await this.api.findCustomerByName(access, input.displayName);
      if (isOk(raced) && raced.value) {
        logger.info({ orgId, malletId: customer.id }, "qbo.customer.linked_after_create_conflict");
        return await this.link(customer.id, raced.value.id, raced.value.displayName, "matched_name");
      }
      return await this.fail(customer.id, created.error);
    }

    return await this.link(customer.id, created.value.id, created.value.displayName, "created");
  }

  private async link(
    malletId: string,
    qboId: string,
    displayName: string,
    via: EnsureQboCustomerResult["via"],
  ): Promise<Result<EnsureQboCustomerResult, AppError>> {
    await this.links.save({
      entityType: ENTITY,
      malletId,
      qboId,
      // Customers are neither Employee nor Vendor — the kind column exists for the crew matcher.
      qboEntityKind: null,
      displayName,
    });
    await this.record(malletId, qboId, "succeeded", null, null);
    return ok({ qboId, via });
  }

  private async fail(malletId: string, error: AppError): Promise<Result<EnsureQboCustomerResult, AppError>> {
    await this.record(malletId, null, "failed", error.kind, error.message);
    return err(error);
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
