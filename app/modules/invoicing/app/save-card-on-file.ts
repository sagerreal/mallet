import { and, eq, isNull } from "drizzle-orm";
import { estimates, invoices } from "@mallet/shared/db/schema";
import { withTenant, type TenantTx } from "@mallet/shared/db/tx";
import { asLeadId, asOrgId, systemClock, isOk, type OrgId } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import { PaymentProfile } from "../domain/payment-profile";
import type { CardOnFileVia } from "../domain/payment-profile";
import { DrizzlePaymentProfileStore } from "../infra/drizzle-payment-profile-store";
import type { CaptureSubject, SavedCardFacts } from "./capture-card-on-file";

/**
 * Upsert the customer's card on file from a settled checkout — the persistence half of
 * captureCardOnFile, shaped exactly like quoting's recordEstimateDeposit: called by BOTH Stripe
 * entry points (webhook and /pay/success reconcile) and safe to run twice, because the store's
 * save is an upsert on (org, lead).
 *
 * The LEAD is resolved server-side from the subject — the invoice's or the estimate's own row —
 * never from anything the session could be made to say beyond the ids WE stamped at create time.
 *
 * @returns true when the card is on file after this call; false when the subject cannot hold it
 * (invoice/estimate missing or soft-deleted — its customer is not resolvable). Throws only on a
 * transient infra failure, which captureCardOnFile catches and logs: a card fact must never fail
 * the settled payment it rode in on.
 */
export async function saveCardOnFile(args: {
  orgId: string;
  subject: CaptureSubject;
  card: SavedCardFacts;
  via: CardOnFileVia;
}): Promise<boolean> {
  const tenant: OrgId = asOrgId(args.orgId);
  return withTenant(tenant, async (tx) => {
    const leadId = await leadFor(tx, tenant, args.subject);
    if (!leadId) return false;

    const profile = PaymentProfile.create({
      id: uuidGenerator.newId(),
      leadId: asLeadId(leadId),
      stripeCustomerId: args.card.customerId,
      stripePaymentMethodId: args.card.paymentMethodId,
      brand: args.card.brand,
      last4: args.card.last4,
      via: args.via,
      savedAt: systemClock.now(),
    });
    if (!isOk(profile)) {
      // Stripe handed back facts the domain refuses (e.g. a non-numeric last4 on some exotic
      // instrument). Not transient — log loudly and decline to store, rather than throw and
      // make the webhook redeliver a payment that is already recorded.
      logger.error(
        { orgId: args.orgId, err: profile.error.message },
        "card-on-file facts failed validation — profile not saved",
      );
      return false;
    }

    await new DrizzlePaymentProfileStore(tx, tenant).save(profile.value);
    return true;
  });
}

// The subject's customer, read off its own row. Focused single-column reads (same seam style as
// DrizzleEstimateDepositReader) rather than loading whole aggregates for one fact.
const leadFor = async (
  tx: TenantTx,
  orgId: OrgId,
  subject: CaptureSubject,
): Promise<string | null> => {
  if (subject.kind === "payment") {
    const rows = await tx
      .select({ leadId: invoices.leadId })
      .from(invoices)
      .where(and(eq(invoices.orgId, orgId), eq(invoices.id, subject.invoiceId), isNull(invoices.deletedAt)))
      .limit(1);
    return rows[0]?.leadId ?? null;
  }
  const rows = await tx
    .select({ leadId: estimates.leadId })
    .from(estimates)
    .where(and(eq(estimates.orgId, orgId), eq(estimates.id, subject.estimateId), isNull(estimates.deletedAt)))
    .limit(1);
  return rows[0]?.leadId ?? null;
};
