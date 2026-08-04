import type Stripe from "stripe";
import { z } from "zod";

// Success-page reconcile: the customer just returned from Stripe Checkout, and the webhook —
// the PRIMARY recorder — may not have landed yet. This retrieves the session server-side and
// records it through the SAME idempotent ledger path, so whichever of the two arrives second
// dedups to a no-op.
//
// IDEMPOTENCY KEY: the session's payment_intent id (pi_…) — IDENTICAL to what the webhook uses
// (stripe-webhook.ts → RecordCardPaymentUseCase keys the ledger row on paymentIntentId). Keying
// reconcile on anything else (e.g. the session id) would let webhook + reconcile double-record
// the same settled charge.

// Metadata WE stamped at checkout-create time. Trusted only because the session was retrieved
// from Stripe's API server-side — never parsed from anything the browser sent beyond the cs_ id.
// `kind` routes the recorder: absent/'payment' → invoice payment; 'deposit' arrives in Task 8.
const metadataSchema = z.object({
  orgId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  kind: z.enum(["payment", "deposit"]).optional(),
});

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

  const metadata = metadataSchema.safeParse(session.metadata ?? {});
  if (!metadata.success) {
    deps.log("pay reconcile: missing/invalid session metadata", { sessionId });
    return { recorded: false, reason: "invalid_metadata" };
  }

  // Route by kind NOW so Task 8 only swaps the deposit arm: absent/'payment' → invoice payment;
  // 'deposit' → not yet supported here (the webhook still records it when Task 8 lands).
  const kind = metadata.data.kind ?? "payment";
  if (kind === "deposit") return { recorded: false, reason: "unsupported" };

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  const amountCents = session.amount_total;
  if (!paymentIntentId || amountCents == null) {
    deps.log("pay reconcile: paid session missing payment_intent or amount", { sessionId });
    return { recorded: false, reason: "missing_fields" };
  }

  await deps.recordPayment(metadata.data.orgId, metadata.data.invoiceId, amountCents, paymentIntentId);
  return { recorded: true };
};
