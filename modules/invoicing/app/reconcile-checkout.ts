import type Stripe from "stripe";
import { parseCheckoutMetadata, isDepositMetadata } from "./checkout-metadata";

// Success-page reconcile: the customer just returned from Stripe Checkout, and the webhook —
// the PRIMARY recorder — may not have landed yet. This retrieves the session server-side and
// records it through the SAME idempotent path as the webhook, so whichever of the two arrives
// second dedups to a no-op.
//
// IDEMPOTENCY, per kind:
//   payment — the session's payment_intent id (pi_…), IDENTICAL to what the webhook uses
//     (stripe-webhook.ts → RecordCardPaymentUseCase keys the ledger row on paymentIntentId).
//     Keying on anything else (e.g. the session id) would let webhook + reconcile double-record.
//   deposit — the SAME payment_intent id, as `payment_ref` on its own append-only ledger
//     (estimate_deposits, UNIQUE on (org_id, payment_ref)). Deposits cannot use the `payments`
//     table (invoice-scoped by composite FK, and an accepted quote has no invoice yet), but they
//     use the same IDENTITY, because identity is the only thing that separates one payment
//     delivered twice from two different payments on one quote.

export interface ReconcileCheckoutDeps {
  // Server-side session retrieve (StripeClient.retrieveCheckoutSession). Throwing signals a
  // transient provider failure → the route answers 503 and the webhook remains the recorder.
  retrieveSession: (sessionId: string) => Promise<Stripe.Checkout.Session>;
  // Records the settled card payment via withTenant + the idempotent ledger path — the exact
  // wiring the Stripe webhook route uses.
  recordPayment: (
    orgId: string,
    invoiceId: string,
    amountCents: number,
    paymentIntentId: string,
  ) => Promise<void>;
  // Records the settled quote deposit on its ledger. Returns whether THIS PAYMENT is recorded
  // (appended now, or already there under the same paymentRef); false when the estimate cannot
  // hold it. `paymentRef` is the payment_intent id — identical to the webhook's.
  recordDeposit: (
    orgId: string,
    estimateId: string,
    amountCents: number,
    paymentRef: string,
  ) => Promise<boolean>;
  log: (message: string, ctx?: Record<string, unknown>) => void;
}

export interface ReconcileOutcome {
  readonly recorded: boolean;
  readonly reason?: string;
}

export const reconcileCheckoutSession = async (
  sessionId: string,
  deps: ReconcileCheckoutDeps,
): Promise<ReconcileOutcome> => {
  const session = await deps.retrieveSession(sessionId);

  // Only settled money is recorded — an open/expired session is simply "nothing to do".
  if (session.payment_status !== "paid") return { recorded: false, reason: "not_paid" };

  const metadata = parseCheckoutMetadata(session.metadata);
  if (!metadata.ok) {
    deps.log("pay reconcile: missing/invalid session metadata", { sessionId });
    return { recorded: false, reason: "invalid_metadata" };
  }

  const amountCents = session.amount_total;
  // Extracted ONCE, before the kind branch, exactly as stripe-webhook.ts does it: both recorders,
  // on both delivery paths, must key on the same value or the dedup does not hold.
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);

  // Route by kind: absent/'payment' → invoice payment; 'deposit' → the estimate's deposit ledger.
  if (isDepositMetadata(metadata.value)) {
    // No payment_intent means no identity, and a deposit without identity cannot be deduplicated
    // against the webhook's delivery of the same money.
    if (amountCents == null || !paymentIntentId) {
      deps.log("pay reconcile: paid deposit session missing amount or payment_intent", { sessionId });
      return { recorded: false, reason: "missing_fields" };
    }
    const recorded = await deps.recordDeposit(
      metadata.value.orgId,
      metadata.value.estimateId,
      amountCents,
      paymentIntentId,
    );
    if (!recorded) {
      deps.log("pay reconcile: deposit could not be recorded on the estimate", {
        sessionId,
        orgId: metadata.value.orgId,
        estimateId: metadata.value.estimateId,
      });
      return { recorded: false, reason: "not_recordable" };
    }
    return { recorded: true };
  }

  if (!paymentIntentId || amountCents == null) {
    deps.log("pay reconcile: paid session missing payment_intent or amount", { sessionId });
    return { recorded: false, reason: "missing_fields" };
  }

  await deps.recordPayment(metadata.value.orgId, metadata.value.invoiceId, amountCents, paymentIntentId);
  return { recorded: true };
};
