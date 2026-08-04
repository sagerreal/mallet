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
//   deposit — there is no ledger row to key: a deposit writes estimates.dep_paid_cents, and the
//     payments table is invoice-scoped (composite FK) while an accepted quote has no invoice yet.
//     The equivalent guarantee is the conditional UPDATE behind recordDeposit, which fires only
//     while the stored deposit is strictly less than the incoming amount.

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
  // Records the settled quote deposit onto the estimate. Returns whether the deposit is on the
  // estimate (written now, or already there); false when the estimate cannot hold it.
  recordDeposit: (orgId: string, estimateId: string, amountCents: number) => Promise<boolean>;
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

  // Route by kind: absent/'payment' → invoice payment; 'deposit' → the estimate's deposit.
  if (isDepositMetadata(metadata.value)) {
    if (amountCents == null) {
      deps.log("pay reconcile: paid deposit session missing amount", { sessionId });
      return { recorded: false, reason: "missing_fields" };
    }
    const recorded = await deps.recordDeposit(
      metadata.value.orgId,
      metadata.value.estimateId,
      amountCents,
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

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  if (!paymentIntentId || amountCents == null) {
    deps.log("pay reconcile: paid session missing payment_intent or amount", { sessionId });
    return { recorded: false, reason: "missing_fields" };
  }

  await deps.recordPayment(metadata.value.orgId, metadata.value.invoiceId, amountCents, paymentIntentId);
  return { recorded: true };
};
