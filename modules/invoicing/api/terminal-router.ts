import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asInvoiceId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TerminalGateway } from "../domain/terminal-gateway";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { DrizzleTerminalLocationStore } from "../infra/drizzle-terminal-location-store";
import { CreateTerminalConnectionTokenUseCase, CONNECT_NOT_READY } from "../app/terminal-connection-token";
import { EnsureTerminalLocationUseCase } from "../app/ensure-terminal-location";
import { CreateTapPaymentIntentUseCase } from "../app/create-tap-payment-intent";
import { reconcileTapPayment } from "../app/reconcile-tap-payment";
import { RecordCardPaymentUseCase } from "../app/record-card-payment";
import { loadInvoiceInScope } from "./field-invoice-scope";

/**
 * Stripe Terminal (Tap to Pay) — the server half of phone-as-reader payments. The native reader
 * flow (Terminal SDK discover/connect/collect/confirm) ships in a later native-plugin PR; these
 * procedures are what that plugin's JS driver will call, and createTapPaymentIntent/
 * reconcileTapPayment are shaped exactly like the existing card rails (mint → settle at Stripe →
 * record idempotently).
 *
 * EVERY procedure is `anyRole`, because the person holding the phone at the door is usually a
 * technician — and every one is guarded:
 *   • connectionToken / location are org-scoped setup reads/writes with NO client input reaching
 *     Stripe (the location is created from the shop's own stored profile). They expose nothing a
 *     tech can't already act on — a connection token only drives a reader for their own shop —
 *     and both refuse with PRECONDITION_FAILED until Connect onboarding is finished.
 *   • createTapPaymentIntent / reconcileTapPayment are invoice-addressed and pass through
 *     loadInvoiceInScope — the identical load-then-prove step the field money surface uses, with
 *     the same flattened NOT_FOUND for anything outside the caller's own jobs.
 *
 * Unconfigured Stripe (no terminalGateway in deps) answers PRECONDITION_FAILED with the same
 * sentence the field checkout mint uses — never a dead endpoint that pretends to work.
 */

const invoiceIdInput = z.object({ invoiceId: z.string().uuid() });
const reconcileInput = z.object({
  invoiceId: z.string().uuid(),
  // The pi_… id the device just confirmed. A pointer only — everything recorded is retrieved
  // server-side from the org's own connected account (see reconcile-tap-payment.ts).
  paymentIntentId: z.string().min(4).max(255).regex(/^pi_/),
});

const gatewayOrRefuse = (gateway: TerminalGateway | null | undefined): TerminalGateway => {
  if (!gateway) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "card payments are not enabled" });
  }
  return gateway;
};

export const createTerminalRouter = () =>
  router({
    /**
     * Mint the short-lived token the phone's Terminal SDK authenticates its reader session with.
     * Scoped to the org's Terminal Location when one exists. No input at all.
     */
    connectionToken: anyRole
      .output(z.object({ secret: z.string() }))
      .mutation(async ({ ctx }) => {
        const gateway = gatewayOrRefuse(ctx.deps.terminalGateway);
        const useCase = new CreateTerminalConnectionTokenUseCase(
          gateway,
          new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId),
          new DrizzleTerminalLocationStore(ctx.tx, ctx.principal.orgId, ctx.deps.clock),
        );
        const token = orThrow(await useCase.exec());
        return { secret: token.secret };
      }),

    /**
     * Ensure-read of the org's ONE Terminal Location: returns the stored id, creating it on the
     * connected account first if this is the org's first Terminal call. A mutation (not a query)
     * because that first call writes — to Stripe and to org_settings.
     */
    location: anyRole
      .output(z.object({ locationId: z.string(), created: z.boolean() }))
      .mutation(async ({ ctx }) => {
        const gateway = gatewayOrRefuse(ctx.deps.terminalGateway);
        const useCase = new EnsureTerminalLocationUseCase(
          gateway,
          new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId),
          new DrizzleTerminalLocationStore(ctx.tx, ctx.principal.orgId, ctx.deps.clock),
        );
        return orThrow(await useCase.exec({ orgId: ctx.principal.orgId }));
      }),

    /**
     * Mint the card_present intent the phone collects against. Assignment-gated exactly like the
     * other field payment endpoints (guard FIRST, gateway check second — same ordering and same
     * existence-oracle reasoning as fieldInvoicing.createPayment). Charges the FULL balance; the
     * technician cannot choose an amount.
     */
    createTapPaymentIntent: anyRole
      .input(invoiceIdInput)
      .output(
        z.object({
          paymentIntentId: z.string(),
          clientSecret: z.string(),
          amountCents: z.number().int().positive(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        await loadInvoiceInScope(invoiceId, ctx);
        const gateway = gatewayOrRefuse(ctx.deps.terminalGateway);
        const useCase = new CreateTapPaymentIntentUseCase(
          new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId),
          gateway,
          new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId),
        );
        return orThrow(await useCase.exec({ orgId: ctx.principal.orgId, invoiceId }));
      }),

    /**
     * The device just confirmed the intent — retrieve it from the org's connected account and
     * record the settled money through the SAME idempotent path as every other card payment.
     * `recorded: false` outcomes are answers, not errors (nothing settled / wrong target);
     * transient Stripe failures throw BAD_GATEWAY so the device retries. After a recorded=true
     * the client re-reads the invoice via fieldInvoicing.get, which is already how the checkout
     * QR flow adopts a settled balance.
     */
    reconcileTapPayment: anyRole
      .input(reconcileInput)
      .output(z.object({ recorded: z.boolean(), reason: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        await loadInvoiceInScope(invoiceId, ctx);
        const gateway = gatewayOrRefuse(ctx.deps.terminalGateway);

        // The retrieve is bound to the org's OWN connected account — an intent living anywhere
        // else is unreachable by construction, before any metadata check runs.
        const target = await new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId).read();
        if (!target.connectedAccountId) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: CONNECT_NOT_READY });
        }
        const connectedAccountId = target.connectedAccountId;

        const recorder = new RecordCardPaymentUseCase(
          new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return reconcileTapPayment(
          { orgId: ctx.principal.orgId, invoiceId, paymentIntentId: input.paymentIntentId },
          {
            retrieveIntent: async (paymentIntentId) => {
              const intent = await gateway.retrieveTapPaymentIntent(connectedAccountId, paymentIntentId);
              // A transient provider failure throws → BAD_GATEWAY → the device retries; the
              // recorder never runs on a guess.
              if (!intent.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: intent.error.message });
              return intent.value;
            },
            recordPayment: async (invId, amountCents, paymentIntentId) => {
              orThrow(
                await recorder.exec({
                  orgId: ctx.principal.orgId,
                  invoiceId: asInvoiceId(invId),
                  amountCents,
                  paymentIntentId,
                }),
              );
            },
            log: (message, logCtx) => logger.warn(logCtx ?? {}, message),
          },
        );
      }),
  });
