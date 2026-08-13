"use client";

/**
 * lib/native/tap-to-pay-collect.ts
 * The whole tap, end to end, as one call — mint → collect → reconcile.
 *
 * The three steps have to travel together because the middle one is the dangerous one: once
 * `collectPayment` resolves `succeeded`, the customer's card HAS been charged on the shop's
 * connected account. If reconcile never runs, the money exists at Stripe and Mallet does not know
 * about it — a real payment invisible to the shop. So reconcile is not "the next thing the UI
 * does", it is part of this function, and its failure is reported as a distinct outcome rather
 * than folded into a generic error.
 *
 * ORDER MATTERS FOR ANOTHER REASON. `createTapPaymentIntent` is idempotency-keyed per
 * (org, invoice, balance, account, fee), so a declined-card retry reuses ONE intent instead of
 * minting a second — Stripe's own double-charge guidance. Nothing here may bypass it.
 */

import { trpcVanilla } from "@/lib/trpc/vanilla";
import { tapToPayPlugin } from "./tap-to-pay";

/** What happened, in the terms the close-out has to speak (Apple 5.9). */
export type TapOutcome =
  | { readonly status: "succeeded"; readonly paymentIntentId: string }
  | { readonly status: "cancelled" }
  /**
   * Charged at Stripe, NOT recorded in Mallet. Deliberately its own outcome: telling somebody the
   * payment failed when their customer's card was charged is the worst thing this flow can say.
   */
  | { readonly status: "unreconciled"; readonly paymentIntentId: string; readonly message: string }
  | { readonly status: "failed"; readonly message: string };

/**
 * The org's Terminal location, created once and remembered server-side.
 *
 * Every reader call needs it, so this resolves it before anything else — including before the
 * warm-up, which cannot connect without one.
 */
export async function tapToPayLocationId(): Promise<string> {
  const { locationId } = await trpcVanilla.v1.terminal.location.mutate();
  return locationId;
}

/**
 * Warm the reader (Apple 1.5). Safe to call repeatedly and never throws — a failed warm-up is not
 * something to interrupt anybody with, and the tap will connect on demand regardless.
 */
export async function prepareTapToPay(): Promise<void> {
  const plugin = tapToPayPlugin();
  if (!plugin?.prepare) return;
  try {
    const locationId = await tapToPayLocationId();
    await plugin.prepare({ locationId });
  } catch {
    // Speculative by design. The tap reports anything real.
  }
}

/**
 * Take a payment for one invoice.
 *
 * @param invoiceId the invoice being settled; the server derives the amount from its BALANCE, so
 *   no amount crosses from the client and a tampered client cannot charge a different number.
 */
export async function collectTapToPay(invoiceId: string): Promise<TapOutcome> {
  const plugin = tapToPayPlugin();
  if (!plugin?.collectPayment) {
    return { status: "failed", message: "Tap to Pay needs the Mallet iPhone app." };
  }

  let locationId: string;
  let clientSecret: string;
  try {
    locationId = await tapToPayLocationId();
    const intent = await trpcVanilla.v1.terminal.createTapPaymentIntent.mutate({ invoiceId });
    clientSecret = intent.clientSecret;
  } catch (error) {
    // Nothing has been charged — a mint failure is safe to report plainly.
    return { status: "failed", message: messageFor(error) };
  }

  let result: Awaited<ReturnType<NonNullable<typeof plugin.collectPayment>>>;
  try {
    result = await plugin.collectPayment({ clientSecret, locationId });
  } catch (error) {
    return { status: "failed", message: messageFor(error) };
  }
  if (result.status === "cancelled") return { status: "cancelled" };

  // From here the card HAS been charged. Every path below must say so.
  const { paymentIntentId } = result;
  try {
    const recorded = await trpcVanilla.v1.terminal.reconcileTapPayment.mutate({
      invoiceId,
      paymentIntentId,
    });
    if (!recorded.recorded) {
      return {
        status: "unreconciled",
        paymentIntentId,
        message: recorded.reason ?? "The card was charged but the payment hasn't been recorded yet.",
      };
    }
    return { status: "succeeded", paymentIntentId };
  } catch (error) {
    return { status: "unreconciled", paymentIntentId, message: messageFor(error) };
  }
}

/**
 * Retry just the recording half.
 *
 * The reconcile is idempotent server-side (keyed on the `pi_…` id), so this is safe to call any
 * number of times — and it is the one action that resolves an `unreconciled` outcome without
 * touching the customer's card again.
 */
export async function retryTapReconcile(
  invoiceId: string,
  paymentIntentId: string,
): Promise<TapOutcome> {
  try {
    const recorded = await trpcVanilla.v1.terminal.reconcileTapPayment.mutate({
      invoiceId,
      paymentIntentId,
    });
    if (!recorded.recorded) {
      return {
        status: "unreconciled",
        paymentIntentId,
        message: recorded.reason ?? "Still not recorded — the office can settle this by hand.",
      };
    }
    return { status: "succeeded", paymentIntentId };
  } catch (error) {
    return { status: "unreconciled", paymentIntentId, message: messageFor(error) };
  }
}

/** A sentence somebody standing at a customer's door can act on. Never a raw error object. */
function messageFor(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Tap to Pay couldn't finish. Try again, or take payment another way.";
}
