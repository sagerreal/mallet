import type Stripe from "stripe";
import { parseCheckoutMetadata, isDepositMetadata } from "./checkout-metadata";

export interface StripeWebhookDeps {
  // Records the settled card payment (org resolved from event metadata) via withTenant + the
  // idempotent ledger path. Throwing signals a transient failure → the route returns 500 so Stripe
  // retries.
  record: (orgId: string, invoiceId: string, amountCents: number, paymentIntentId: string) => Promise<void>;
  /**
   * Records a settled quote DEPOSIT onto estimates.dep_paid_cents. Returns whether the deposit is
   * on the estimate (true when this call wrote it OR a duplicate delivery already had); false when
   * the estimate cannot hold it (missing, or no longer approved). Throwing means transient → 500.
   *
   * Idempotency is NOT the payment_intent key the invoice path uses: deposits do not write to the
   * payments ledger (invoice-scoped, composite FK), so the guarantee comes from the conditional
   * UPDATE behind this call — see RecordEstimateDepositUseCase.
   */
  recordDeposit: (orgId: string, estimateId: string, amountCents: number) => Promise<boolean>;
  log: (message: string, ctx?: Record<string, unknown>) => void;
}

// Pure orchestration over an ALREADY-VERIFIED Stripe event (signature checked by the caller). Only
// checkout.session.completed with payment_status 'paid' records money; everything else is a logged
// 200 no-op (so Stripe does not retry un-processable events). The caller maps a thrown record()
// (transient infra failure) to 500.
//
// Two kinds of money arrive here and they settle in different places: an invoice payment goes to
// the payments ledger, a quote deposit goes to estimates.dep_paid_cents. The metadata `kind`
// decides which, and a deposit must NEVER reach the payment recorder — that would credit an
// unrelated invoice with the customer's deposit.
export const processStripeEvent = async (
  event: Stripe.Event,
  deps: StripeWebhookDeps,
): Promise<{ status: number }> => {
  if (event.type !== "checkout.session.completed") return { status: 200 };

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return { status: 200 };

  const metadata = parseCheckoutMetadata(session.metadata);
  if (!metadata.ok) {
    deps.log("stripe webhook: missing/invalid metadata", { eventId: event.id });
    return { status: 200 };
  }

  const amountCents = session.amount_total;

  if (isDepositMetadata(metadata.value)) {
    // Amount from Stripe's own amount_total, never from metadata — metadata is what WE wrote at
    // create time, and the charge is what actually settled.
    if (amountCents == null) {
      deps.log("stripe webhook: paid deposit session missing amount", { eventId: event.id });
      return { status: 200 };
    }
    const recorded = await deps.recordDeposit(
      metadata.value.orgId,
      metadata.value.estimateId,
      amountCents,
    );
    if (!recorded) {
      // 200 on purpose: retrying will not make an unapproved/absent estimate able to hold the
      // deposit, and a 500 here would have Stripe redeliver for days. Logged loudly instead —
      // real money is sitting on a charge with nowhere to land, and someone must see it.
      deps.log("stripe webhook: deposit could not be recorded on the estimate", {
        eventId: event.id,
        orgId: metadata.value.orgId,
        estimateId: metadata.value.estimateId,
        amountCents,
      });
    }
    return { status: 200 };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  if (!paymentIntentId || amountCents == null) {
    deps.log("stripe webhook: missing payment_intent or amount", { eventId: event.id });
    return { status: 200 };
  }

  await deps.record(metadata.value.orgId, metadata.value.invoiceId, amountCents, paymentIntentId);
  return { status: 200 };
};
