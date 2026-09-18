import type { RetrievedTapIntent } from "../domain/terminal-gateway";

/**
 * Device-driven reconcile: the phone just confirmed a Tap to Pay intent (Terminal SDK collect +
 * confirm, automatic capture) and calls this to get the settled money RECORDED. The chosen
 * posture, and why it is the reconcile read rather than the webhook:
 *
 * Tap intents are DIRECT charges on the shop's connected account, and the platform webhook
 * endpoint (/api/webhooks/stripe) only receives platform-account events — a connected account's
 * `payment_intent.succeeded` would need a separate Connect webhook endpoint with its own signing
 * secret, which does not exist yet. So this PR mirrors the OTHER half of the existing posture:
 * exactly like the Checkout success page (reconcile-checkout.ts), the client that just watched
 * the payment settle asks the server to retrieve the source of truth from Stripe and record it.
 * The recorder is the SAME idempotent path (RecordCardPaymentUseCase, keyed on the pi_… id), so
 * if a Connect webhook is added later the two deliveries dedup to one ledger row — the identical
 * two-recorder contract Checkout already lives by.
 *
 * TRUST BOUNDARY. The caller supplies a pi id, and nothing else it says is believed:
 *   • the retrieve runs ON the org's own connected account (the gateway is bound to the
 *     principal's Connect target), so another shop's intent simply cannot be fetched;
 *   • the metadata WE stamped at create time must name this org, this invoice, and kind "tap" —
 *     a Checkout session's intent (kind "payment") is refused here even though it, too, is real
 *     settled money, because the webhook/success-page pair already owns recording it;
 *   • the recorded amount is Stripe's amount_received, never a client figure.
 */

export interface ReconcileTapPaymentDeps {
  /** Retrieves the intent from the org's connected account. Throwing = transient → caller 5xx. */
  retrieveIntent: (paymentIntentId: string) => Promise<RetrievedTapIntent>;
  /** Records via the idempotent card-payment path (RecordCardPaymentUseCase wiring). */
  recordPayment: (invoiceId: string, amountCents: number, paymentIntentId: string) => Promise<void>;
  log: (message: string, ctx?: Record<string, unknown>) => void;
}

export interface ReconcileTapCommand {
  readonly orgId: string;
  readonly invoiceId: string;
  readonly paymentIntentId: string;
}

export interface ReconcileTapOutcome {
  readonly recorded: boolean;
  readonly reason?: string;
}

export const reconcileTapPayment = async (
  cmd: ReconcileTapCommand,
  deps: ReconcileTapPaymentDeps,
): Promise<ReconcileTapOutcome> => {
  const intent = await deps.retrieveIntent(cmd.paymentIntentId);

  // Only settled money is recorded. requires_capture cannot appear (intents are minted with
  // automatic capture); anything short of succeeded is "nothing to record yet", not an error.
  if (intent.status !== "succeeded") return { recorded: false, reason: "not_succeeded" };

  // ONE flattened refusal for every identity mismatch, mirroring the field guard's posture: a
  // distinguishable answer per failed check would let a caller probe which part matched.
  const m = intent.metadata;
  if (m.kind !== "tap" || m.orgId !== cmd.orgId || m.invoiceId !== cmd.invoiceId) {
    deps.log("tap reconcile: intent metadata does not match the addressed invoice", {
      paymentIntentId: cmd.paymentIntentId,
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
    });
    return { recorded: false, reason: "wrong_target" };
  }

  if (intent.amountReceivedCents <= 0) {
    deps.log("tap reconcile: succeeded intent carries no received amount", {
      paymentIntentId: cmd.paymentIntentId,
    });
    return { recorded: false, reason: "missing_fields" };
  }

  await deps.recordPayment(cmd.invoiceId, intent.amountReceivedCents, cmd.paymentIntentId);
  return { recorded: true };
};
