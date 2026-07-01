import type Stripe from "stripe";
import { z } from "zod";

// Metadata WE stamped at checkout-create time. Trusted only from the (already signature-verified)
// Stripe event — never from client-supplied headers/body.
const metadataSchema = z.object({
  orgId: z.string().uuid(),
  invoiceId: z.string().uuid(),
});

export interface StripeWebhookDeps {
  // Records the settled card payment (org resolved from event metadata) via withTenant + the
  // idempotent ledger path. Throwing signals a transient failure → the route returns 500 so Stripe
  // retries.
  record: (orgId: string, invoiceId: string, amountCents: number, paymentIntentId: string) => Promise<void>;
  log: (message: string, ctx?: Record<string, unknown>) => void;
}

// Pure orchestration over an ALREADY-VERIFIED Stripe event (signature checked by the caller). Only
// checkout.session.completed with payment_status 'paid' records money; everything else is a logged
// 200 no-op (so Stripe does not retry un-processable events). The caller maps a thrown record()
// (transient infra failure) to 500.
export const processStripeEvent = async (
  event: Stripe.Event,
  deps: StripeWebhookDeps,
): Promise<{ status: number }> => {
  if (event.type !== "checkout.session.completed") return { status: 200 };

  const session = event.data.object as Stripe.Checkout.Session;
  if (session.payment_status !== "paid") return { status: 200 };

  const metadata = metadataSchema.safeParse(session.metadata ?? {});
  if (!metadata.success) {
    deps.log("stripe webhook: missing/invalid metadata", { eventId: event.id });
    return { status: 200 };
  }

  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  const amountCents = session.amount_total;
  if (!paymentIntentId || amountCents == null) {
    deps.log("stripe webhook: missing payment_intent or amount", { eventId: event.id });
    return { status: 200 };
  }

  await deps.record(metadata.data.orgId, metadata.data.invoiceId, amountCents, paymentIntentId);
  return { status: 200 };
};
