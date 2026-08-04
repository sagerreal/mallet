import { NextResponse } from "next/server";
import { z } from "zod";
import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { asOrgId, asInvoiceId } from "@mallet/shared/types";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { FixedWindowLimiter } from "@mallet/platform/resilience";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { DrizzleInvoiceRepository, RecordCardPaymentUseCase, reconcileCheckoutSession } from "@mallet/invoicing";
import { recordEstimateDeposit } from "@mallet/quoting";
import { getAppDeps } from "@/trpc/di";

// Success-page reconcile — a plain Next route (NOT tRPC), unauthenticated by design: the customer
// just returned from Stripe Checkout with a session id in the query. The cs_ id is only a POINTER;
// everything recorded (paid status, amount, org/invoice) is retrieved server-side from Stripe's
// API, so a forged or replayed id can at worst re-record a genuinely settled charge — which the
// shared payment_intent idempotency key (identical to the webhook's) dedups to a no-op. The
// webhook remains the PRIMARY recorder; this only closes the gap while it is in flight.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().min(4).max(255).regex(/^cs_/),
});

// Throttle — the sharpest public edge: every accepted POST costs a REAL Stripe API retrieve.
// Keyed on the caller's IP (Vercel-set x-forwarded-for, not client-forgeable there); when no IP
// header exists the session id keys instead, so the endpoint is never unthrottled. Generous —
// the success page fires this exactly once per checkout return.
const reconcileLimiter = new FixedWindowLimiter({ limit: 10, windowMs: 60_000 });

const clientIp = (req: Request): string | null =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("x-real-ip")?.trim() ||
  null;

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();
  if (!config.STRIPE_SECRET_KEY) {
    return NextResponse.json({ recorded: false }, { status: 503 });
  }

  const ip = clientIp(req);
  if (ip && !reconcileLimiter.allow(`ip:${ip}`)) {
    return NextResponse.json({ error: "too many requests — try again in a minute" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!ip && !reconcileLimiter.allow(`sid:${parsed.data.sessionId}`)) {
    return NextResponse.json({ error: "too many requests — try again in a minute" }, { status: 429 });
  }

  // Shared process-wide client: the breaker must see ALL Stripe traffic to ever trip.
  const client = getSharedStripeClient(config.STRIPE_SECRET_KEY);
  const deps = getAppDeps();

  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      const outcome = await reconcileCheckoutSession(parsed.data.sessionId, {
        retrieveSession: (id) => client.retrieveCheckoutSession(id),
        // Identical recorder wiring to the Stripe webhook route: withTenant + the tx-bound outbox
        // bus + RecordCardPaymentUseCase keyed on the payment_intent id.
        recordPayment: async (orgId, invoiceId, amountCents, paymentIntentId) => {
          enrichRequestContext({ orgId });
          await withTenant(asOrgId(orgId), async (tx) => {
            const repo = new DrizzleInvoiceRepository(tx, asOrgId(orgId));
            const bus = new OutboxEventBus(tx, asOrgId(orgId));
            const useCase = new RecordCardPaymentUseCase(repo, bus, deps.clock, deps.ids);
            const r = await useCase.exec({
              orgId: asOrgId(orgId),
              invoiceId: asInvoiceId(invoiceId),
              amountCents,
              paymentIntentId,
            });
            if (!r.ok) throw new Error(`reconcile record card payment failed: ${r.error.message}`);
          });
        },
        // Quote deposits land on the estimate's deposit ledger, through the SAME recorder the
        // Stripe webhook uses and keyed on the SAME payment_intent id — whichever of the two
        // arrives second dedups to a no-op inside it.
        recordDeposit: async (orgId, estimateId, amountCents, paymentRef) => {
          enrichRequestContext({ orgId });
          return recordEstimateDeposit(orgId, estimateId, amountCents, paymentRef);
        },
        log: (message, ctx) => logger.warn(ctx ?? {}, message),
      });
      return NextResponse.json(outcome);
    } catch (error) {
      // Transient failure (Stripe retrieve, DB) — the webhook still records the money; the page
      // simply keeps its generic success copy. Nothing sensitive leaves this handler.
      logger.error(
        { err: error instanceof Error ? error.message : String(error), route: "public.pay.reconcile" },
        "pay reconcile failed",
      );
      return NextResponse.json({ recorded: false }, { status: 503 });
    }
  });
}
