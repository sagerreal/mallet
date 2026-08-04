import { loadConfig } from "@mallet/shared/config";
import { withTenant } from "@mallet/shared/db/tx";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { asOrgId, asInvoiceId } from "@mallet/shared/types";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { DrizzleInvoiceRepository, RecordCardPaymentUseCase, processStripeEvent } from "@mallet/invoicing";
import { recordEstimateDeposit } from "@mallet/quoting";
import { getAppDeps } from "@/trpc/di";

// Stripe webhook — a plain Next route (NOT tRPC). Reads the RAW body, verifies the signature, then
// records the settled card payment through the same idempotent + atomic ledger path as manual
// payments. org/invoice come ONLY from the (verified) event metadata; RLS + the composite FK make
// a cross-tenant write impossible even so.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const config = loadConfig();
  if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) {
    return new Response("stripe not configured", { status: 503 });
  }

  const raw = await req.text(); // one-shot stream — read once, before any parsing
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  // Shared process-wide client (one breaker for all Stripe traffic) — a per-request client
  // carried a breaker that was discarded before it could ever trip.
  const client = getSharedStripeClient(config.STRIPE_SECRET_KEY);
  let event;
  try {
    event = client.constructEvent(raw, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response("invalid signature", { status: 400 });
  }

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    try {
      const result = await processStripeEvent(event, {
        record: async (orgId, invoiceId, amountCents, paymentIntentId) => {
          enrichRequestContext({ orgId });
          await withTenant(asOrgId(orgId), async (tx) => {
            const repo = new DrizzleInvoiceRepository(tx, asOrgId(orgId));
            // Emit through the outbox in the SAME tx so invoice.paid/recorded are durable and
            // committed atomically with the ledger write (not the in-memory bus).
            const bus = new OutboxEventBus(tx, asOrgId(orgId));
            const useCase = new RecordCardPaymentUseCase(repo, bus, deps.clock, deps.ids);
            const r = await useCase.exec({
              orgId: asOrgId(orgId),
              invoiceId: asInvoiceId(invoiceId),
              amountCents,
              paymentIntentId,
            });
            if (!r.ok) throw new Error(`record card payment failed: ${r.error.message}`);
          });
        },
        // A quote deposit settles on the ESTIMATE's own append-only ledger, not in the invoice
        // payments table, so it takes its own recorder — the same one the /pay/success reconcile
        // calls, keyed on the same payment_intent id, keeping the two deliveries of one deposit on
        // a single idempotent path. Before this arm existed a deposit session failed the
        // invoice-shaped metadata check and was dropped as a logged 200.
        recordDeposit: async (orgId, estimateId, amountCents, paymentRef) => {
          enrichRequestContext({ orgId });
          return recordEstimateDeposit(orgId, estimateId, amountCents, paymentRef);
        },
        log: (message, ctx) => logger.warn(ctx ?? {}, message),
      });
      return new Response(null, { status: result.status });
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "stripe webhook processing failed",
      );
      return new Response("processing error", { status: 500 });
    }
  });
}
