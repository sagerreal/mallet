import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asInvoiceId, asJobId, money } from "@mallet/shared/types";
import type { OrgId, InvoiceId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { Principal } from "@mallet/identity";
import { DrizzleLeadRepository } from "@mallet/customers";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { isSmsA2pActive } from "@mallet/a2p";
import {
  NOTIFICATION_CHANNELS,
  DrizzleNotificationRepository,
  DrizzleReminderTargetReader,
  LoggingNotificationSender,
  SendNotificationUseCase,
  SendInvoiceDocumentUseCase,
  assertDelivered,
  type NotificationChannel,
} from "@mallet/notifications";
import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import type { Invoice } from "../domain/invoice";
import { RecordCardPaymentUseCase } from "../app/record-card-payment";
import { reconcileCheckoutSession } from "../app/reconcile-checkout";
import { getSharedStripeClient } from "@mallet/platform/adapters/stripe/stripe-client";
import { logger } from "@mallet/shared/observability";
import { PAYMENT_METHODS, type PaymentMethod } from "../domain/payment";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleJobReader } from "../infra/drizzle-job-reader";
import { DrizzleEstimateDepositReader } from "../infra/drizzle-estimate-deposit-reader";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { DrizzleFieldScopeReader } from "../infra/drizzle-field-scope-reader";
import { DrizzleVisitFeeReader } from "../infra/drizzle-visit-fee-reader";
import { DrizzleServiceDateReader } from "../infra/drizzle-service-date-reader";
import { ManualPaymentGateway } from "../infra/manual-payment-gateway";
import { DrizzlePaymentProfileStore } from "../infra/drizzle-payment-profile-store";
import { CreateInvoiceFromJobUseCase } from "../app/create-invoice-from-job";
import { CreatePaymentUseCase } from "../app/create-payment";
import { ChargeCardOnFileUseCase } from "../app/charge-card-on-file";
import { RecordCardPaymentUseCase } from "../app/record-card-payment";
import { SendInvoiceUseCase } from "../app/send-invoice";
import { RecordPaymentUseCase } from "../app/record-payment";
import { DraftInvoiceUseCase } from "../app/draft-invoice";
import { RaiseVisitFeeUseCase } from "../app/raise-visit-fee";
import { fieldInvoiceDTO, toFieldInvoiceDTO } from "./field-invoice-dto";
import {
  assertFieldInvoiceScope,
  assertFieldJobScope,
  fieldInvoiceNotFound,
} from "./field-invoice-guard";

const methodEnum = z.enum(PAYMENT_METHODS as unknown as [PaymentMethod, ...PaymentMethod[]]);
const channelEnum = z.enum(
  NOTIFICATION_CHANNELS as unknown as [NotificationChannel, ...NotificationChannel[]],
);

// The canonical origin for the customer's pay/receipt link — memoized exactly as the notification
// router's does, because loadConfig re-parses the whole schema per call. `undefined` = not resolved
// yet; a resolved `null` (unconfigured deployment) is cached too.
let cachedOrigin: string | null | undefined;
const publicOrigin = (): string | null => {
  if (cachedOrigin === undefined) cachedOrigin = resolvePublicAppOrigin(loadConfig());
  return cachedOrigin;
};

const invoiceIdInput = z.object({ invoiceId: z.string().uuid() });
const jobIdInput = z.object({
  jobId: z.string().uuid(),
  // Client-authored id for the NEW row so the store's optimistic id matches the persisted one
  // (same convention as the office endpoints). The idempotent path ignores it.
  id: z.string().uuid().optional(),
});
/**
 * Raising the visit fee takes the JOB and nothing else.
 *
 * No client-authored `id`, unlike every other create input in this module. The guard authorizes
 * the job; it cannot say anything about an invoice id, so a caller-supplied one would be an
 * unchecked write target — "raise a fee on my own job, into that other invoice". The server mints
 * the id and the caller adopts the returned DTO, which is the house rule anyway.
 */
const raiseVisitFeeInput = z.object({ jobId: z.string().uuid() });

const recordPaymentInput = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  method: methodEnum,
  idempotencyKey: z.string().min(8).max(200),
});

/**
 * The ledger key this payment actually claims.
 *
 * The client's key is NAMESPACED, never used raw. `payments` dedupes on
 * (org_id, idempotency_key) across the whole shop, so a raw caller-chosen key is a squattable
 * global slot: record $1 on your own invoice under key "K", and the next legitimate payment that
 * happens to use "K" — on any invoice, by anyone — is silently swallowed as a "retry" and real
 * money vanishes from the ledger without an error.
 *
 * Binding the invoice and the acting user makes the namespace unforgeable from the client side: a
 * caller can only ever collide with their own earlier payment on the same invoice, which is
 * exactly what a retry IS. The `field:` prefix also keeps this surface's keys disjoint from the
 * office router's raw ones, so neither can consume the other's.
 */
const ledgerKeyFor = (invoiceId: InvoiceId, principal: Principal, clientKey: string): string =>
  `field:${invoiceId}:${principal.userId}:${clientKey}`;

/**
 * The technician's own money surface — field-scoped SIBLINGS of the office invoice procedures,
 * never a role-widening of them.
 *
 * `modules/invoicing/api/invoice-router.ts` is untouched by this file: not one of its
 * `ownerOrOffice` guards changes. The precedent is uniform in this codebase
 * (`field.setVisitStatus` vs `visits.setVisitStatus`, `settings.fieldToggles` vs `settings.get`),
 * and siblings are the only shape that can return a REDACTED DTO — a widened office procedure
 * would hand a technician `cost`, the customer's unauthenticated pay-link token, and the whole
 * payment history along with the balance they actually needed.
 *
 * Every procedure here is `anyRole` and every one is guarded. Owner/office callers pass the guard
 * untouched (they already hold the office surface); for a technician, authorization is
 * `Job.isAssignedTo` on the job the invoice links to. See field-invoice-guard.ts.
 *
 * DELIBERATELY ABSENT, and each for its own reason: `list` / `totals` / `count` / `listByLead` /
 * `listOverdue` (the shop's whole receivables book — a technician's reach is one job), `void`
 * (erasing a bill is *the* cash-pocketing primitive), `updateMetadata` (can move an invoice to
 * another customer, and can reduce the balance due with no payment), `draft` (mints an invoice
 * against ANY lead — not job-scoped, so no guard is even expressible), `patchLines` (a bulk
 * REPLACE, so it can shrink a bill), and `setFollowUp` (collections policy).
 */
export const createFieldInvoiceRouter = () =>
  router({
    /**
     * Raise the bill for a finished job. Idempotent per job.
     *
     * Job-ID-addressed, so it keeps `FORBIDDEN "this job isn't assigned to you"` — a technician
     * legitimately holds job ids from myDay, so there is no existence oracle to close here and
     * naming the real problem is the house copy rule.
     *
     * The use-case is UNCHANGED: it already requires `complete`, already refuses an unpriced
     * estimate, and is already idempotent per job via `invoices_org_source_job_uidx` +
     * ON CONFLICT DO NOTHING.
     */
    createFromJob: anyRole
      .input(jobIdInput)
      .output(fieldInvoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const jobId = asJobId(input.jobId);
        await assertFieldJobScope(jobId, scopeReaderFor(ctx), ctx.principal);
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateInvoiceFromJobUseCase(
          repo,
          new DrizzleJobReader(ctx.tx, ctx.principal.orgId),
          new DrizzleEstimateDepositReader(ctx.tx),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const invoice = orThrow(
          await useCase.exec({
            // From the principal, never from input — the one rule with no exceptions.
            orgId: ctx.principal.orgId,
            jobId,
            id: input.id ? asInvoiceId(input.id) : undefined,
          }),
        );
        return present(invoice, ctx);
      }),

    /**
     * Charge the shop's trip fee on a scoping visit the customer declined.
     *
     * Lead-tied with the job recorded as `scopeJobId` — see RaiseVisitFeeUseCase for why it must
     * not be `sourceJobId`. The AMOUNT IS NOT AN INPUT: it is read from the shop's settings, so
     * the person at the door cannot choose what the customer is charged.
     */
    raiseVisitFee: anyRole
      .input(raiseVisitFeeInput)
      .output(fieldInvoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const jobId = asJobId(input.jobId);
        await assertFieldJobScope(jobId, scopeReaderFor(ctx), ctx.principal);
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RaiseVisitFeeUseCase(
          repo,
          new DrizzleJobReader(ctx.tx, ctx.principal.orgId),
          new DrizzleVisitFeeReader(ctx.tx, ctx.principal.orgId),
          new DraftInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids),
        );
        const invoice = orThrow(
          await useCase.exec({ orgId: ctx.principal.orgId, jobId }),
        );
        return present(invoice, ctx);
      }),

    /**
     * Read one invoice back. The close-out flow needs this three times: to render the sheet, to
     * re-read before recording a payment, and to poll after handing over the QR code — without it
     * the card path never flips to paid on the technician's screen.
     */
    get: anyRole
      .input(invoiceIdInput)
      .output(fieldInvoiceDTO)
      .query(async ({ ctx, input }) => {
        const invoice = await loadInScope(asInvoiceId(input.invoiceId), ctx);
        return present(invoice, ctx);
      }),

    /**
     * draft → sent. Unavoidable before collecting: both RecordPaymentUseCase and
     * CreatePaymentUseCase refuse a draft, so a technician cannot take money without it.
     *
     * NOT innocuous, and worth knowing at the call site: this mints the customer's pay-link token
     * and emits `invoice.sent`, whose registered outbox handler pushes the invoice into the shop's
     * QuickBooks. It does not notify the customer (no notification handler is registered for it).
     */
    send: anyRole
      .input(invoiceIdInput)
      .output(fieldInvoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        await loadInScope(invoiceId, ctx);
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SendInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return present(orThrow(await useCase.exec({ invoiceId })), ctx);
      }),

    /**
     * Hand the customer their copy — the bill while money is owed, the RECEIPT once it is not.
     *
     * THE GAP THIS CLOSES. On a cash-at-the-door close-out the customer used to receive nothing at
     * all: no document on screen, no text, no email. `send` above flips draft -> sent and mints the
     * pay-link token but notifies nobody, and the one endpoint that DOES notify
     * (`v1.notifications.sendInvoiceReminder`) is ownerOrOffice — so the person actually standing
     * in front of the customer had no way to give them anything.
     *
     * WHY A TECHNICIAN MAY DO THIS AND STILL NOT SEE THE TOKEN. The send happens entirely
     * server-side: the destination is read from the lead's own row, the link is composed from the
     * canonical origin plus the invoice's own token, and neither ever crosses to the device. That
     * is what lets this work in a `techSeesPrice: false` shop, where the tech cannot render the
     * itemised document at all — they can still put it in the customer's hands.
     *
     * NOTHING ABOUT THE MESSAGE IS THE CALLER'S CHOICE. No recipient, no channel, no copy — see
     * SendInvoiceDocumentUseCase. The input is an invoice id and nothing else.
     *
     * IT SENDS THE INVOICE FIRST when it is still a draft, because a draft carries no public token
     * and a document message with no document in it is not worth sending. Deliberate and not a
     * side effect: this is the same ordering `approvePayment` and the card step already use, and
     * it is what the office's own Send button does. It therefore also emits `invoice.sent` (which
     * pushes to QuickBooks) exactly once, as any first send does.
     *
     * NOT automatic on payment. Owen's rule: give the option to send, do not send for them.
     */
    sendDocument: anyRole
      .input(invoiceIdInput)
      .output(z.object({ channel: channelEnum }))
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        const invoice = await loadInScope(invoiceId, ctx);
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);

        // A draft has no public token yet, so there would be no document to link to.
        if (invoice.props.status === "draft") {
          orThrow(await new SendInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ invoiceId }));
        }

        // Whether this shop may text at all right now. Passed in rather than gated on: an org
        // without an active 10DLC campaign falls back to EMAIL here instead of failing, which is
        // the difference between "the customer got their receipt" and "nothing happened".
        const smsAllowed = await isSmsA2pActive(ctx.tx, ctx.principal.orgId);

        const send = new SendNotificationUseCase(
          new DrizzleNotificationRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.notificationSender ?? new LoggingNotificationSender(ctx.deps.clock),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const useCase = new SendInvoiceDocumentUseCase(
          new DrizzleReminderTargetReader(ctx.tx, ctx.principal.orgId),
          send,
          ctx.deps.ids,
          publicOrigin(),
        );
        const notification = orThrow(
          await useCase.exec({ orgId: ctx.principal.orgId, invoiceId: input.invoiceId, smsAllowed }),
        );
        // A human just tapped Send. An unconfigured channel or a provider rejection must throw so
        // the close-out can say so and offer a retry — never a silent "Sent".
        const channel = notification.props.channel;
        assertDelivered(notification, channel);
        // The CHANNEL and nothing else: enough for the tech to say "check your texts", with no
        // contact detail, message body or notification id crossing back to the device.
        return { channel };
      }),

    /**
     * Cash, check or bank taken at the door.
     *
     * Every existing control survives, because the use-case is unchanged: the idempotency key is
     * claimed BEFORE settling, the amount must be positive, only a sent/partial invoice takes
     * money, and the balance is incremented by one atomic UPDATE that re-asserts payable status
     * under the row lock.
     *
     * `recordedByUserId` is stamped from the principal — the shop must be able to answer "which
     * technician is holding this cash" to reconcile a drawer, and attribution is the only real
     * mitigation against pocketing (authorization cannot distinguish under-pricing from a
     * discount). `recordPaymentInput` has no such key and must never gain one.
     *
     * The caller's idempotency key is NAMESPACED before it reaches the ledger — see `ledgerKeyFor`.
     * Used raw it is a shop-wide slot anyone can squat, which turns a later legitimate payment into
     * a silent no-op "retry".
     */
    recordPayment: anyRole
      .input(recordPaymentInput)
      .output(fieldInvoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        await loadInScope(invoiceId, ctx);
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RecordPaymentUseCase(
          repo,
          new ManualPaymentGateway(ctx.deps.clock),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const invoice = orThrow(
          await useCase.exec({
            orgId: ctx.principal.orgId,
            invoiceId,
            amount: money(input.amountCents),
            method: input.method,
            // Namespaced server-side — see ledgerKeyFor. The raw client string is never the key.
            idempotencyKey: ledgerKeyFor(invoiceId, ctx.principal, input.idempotencyKey),
            recordedByUserId: ctx.principal.userId,
          }),
        );
        return present(invoice, ctx);
      }),

    /**
     * Charge the customer's card on file for the FULL balance — the field sibling of
     * `v1.invoicing.chargeOnFile`, gated by the same job-assignment scope as every other
     * procedure here (`loadInScope` first, before the gateway answer could become an existence
     * oracle). The office procedure is untouched; this is never a role-widening of it.
     *
     * What the technician CANNOT do here, by construction: choose the amount (the server charges
     * the balance due), see the Stripe pointers (the response is the same redacted field DTO
     * every other procedure returns), or turn a refusal into information (declines carry
     * Stripe's customer-facing sentence and nothing else). Real money moves or this throws —
     * the record is written only after Stripe settles, keyed on the intent id.
     */
    chargeOnFile: anyRole
      .input(z.object({ invoiceId: z.string().uuid(), idempotencyKey: z.string().min(8).max(200) }))
      .output(fieldInvoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        // AUTHORIZE BEFORE ANYTHING ELSE — same ordering (and same reason) as createPayment below.
        await loadInScope(invoiceId, ctx);
        if (!ctx.deps.cardChargeGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "card payments are not enabled" });
        }
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ChargeCardOnFileUseCase(
          repo,
          new DrizzlePaymentProfileStore(ctx.tx, ctx.principal.orgId),
          ctx.deps.cardChargeGateway,
          new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId),
          new RecordCardPaymentUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids),
        );
        const r = orThrow(
          await useCase.exec({
            orgId: ctx.principal.orgId,
            invoiceId,
            // Namespaced like ledgerKeyFor and for the same reason, but for the STRIPE attempt:
            // the ledger's own key is the pi_… id the charge comes back with.
            idempotencyKey: `onfile:field:${invoiceId}:${ctx.principal.userId}:${input.idempotencyKey}`,
            // From the principal, never from input — same law as recordPayment's attribution.
            chargedByUserId: ctx.principal.userId,
          }),
        );
        return present(r.invoice, ctx);
      }),

    /**
     * Mint the Stripe checkout the customer scans at the door. Returns the URL only.
     *
     * The safest write in this router: it touches no ledger (the webhook applies the money),
     * requires completed Connect onboarding, and charges the FULL balance — the technician cannot
     * choose an amount.
     */
    createPayment: anyRole
      .input(invoiceIdInput)
      .output(z.object({ url: z.string().url(), sessionId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        // AUTHORIZE BEFORE ANYTHING ELSE. The office endpoint checks the gateway first, which is
        // harmless there; here it would answer "card payments are not enabled" for an invoice the
        // caller may not even know exists — a different answer than NOT_FOUND, and so exactly the
        // existence oracle the flattened refusal exists to close.
        await loadInScope(invoiceId, ctx);
        if (!ctx.deps.paymentLinkGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "card payments are not enabled" });
        }
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreatePaymentUseCase(
          repo,
          ctx.deps.paymentLinkGateway,
          new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId),
        );
        const result = orThrow(await useCase.exec({ orgId: ctx.principal.orgId, invoiceId }));
        return { url: result.url, sessionId: result.sessionId };
      }),

    /**
     * The field twin of v1.invoicing.reconcileCheckout — the device holding the QR settles the
     * books itself when the customer pays and closes Stripe's tab without the success redirect.
     * Assignment-gated exactly like createPayment: the caller must be on the invoice's job.
     */
    reconcileCheckout: anyRole
      .input(z.object({ invoiceId: z.string().uuid(), sessionId: z.string().min(10).max(200) }))
      .output(z.object({ recorded: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const invoiceId = asInvoiceId(input.invoiceId);
        await loadInScope(invoiceId, ctx);
        const config = loadConfig();
        if (!config.STRIPE_SECRET_KEY) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "card payments are not enabled" });
        }
        const client = getSharedStripeClient(config.STRIPE_SECRET_KEY);
        const orgId = ctx.principal.orgId;
        const outcome = await reconcileCheckoutSession(input.sessionId, {
          retrieveSession: (id) => client.retrieveCheckoutSession(id),
          recordPayment: async (metaOrgId, metaInvoiceId, amountCents, paymentIntentId) => {
            // The session's own metadata must name THIS org and THIS invoice — anything else is
            // a session id fished out of another tenant or another bill.
            if (metaOrgId !== orgId || metaInvoiceId !== input.invoiceId) {
              throw new TRPCError({ code: "NOT_FOUND", message: "invoice not found" });
            }
            const repo = new DrizzleInvoiceRepository(ctx.tx, orgId);
            const useCase = new RecordCardPaymentUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
            orThrow(
              await useCase.exec({ orgId, invoiceId, amountCents, paymentIntentId }),
            );
          },
          recordDeposit: async () => false,
          log: (message, logCtx) => logger.warn(logCtx ?? {}, message),
        });
        return { recorded: outcome.recorded };
      }),
  });

// --- shared procedure plumbing -------------------------------------------------------------

interface FieldCtx {
  readonly tx: TenantTx;
  readonly principal: Principal;
}

const scopeReaderFor = (ctx: FieldCtx) => new DrizzleFieldScopeReader(ctx.tx, ctx.principal.orgId);

/**
 * Load an invoice and prove the caller may transact on it, in that order.
 *
 * A missing invoice and an out-of-scope one raise the SAME NOT_FOUND with the same sentence — see
 * field-invoice-guard.ts. Distinguishing them is what would make this an existence oracle.
 */
const loadInScope = async (invoiceId: InvoiceId, ctx: FieldCtx): Promise<Invoice> => {
  const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
  const invoice = await repo.findById(invoiceId);
  if (!invoice) {
    // Owner/office get the ordinary answer; only a technician gets the flattened one.
    if (ctx.principal.role !== "tech") {
      throw new TRPCError({ code: "NOT_FOUND", message: "invoice not found" });
    }
    throw fieldInvoiceNotFound();
  }
  await assertFieldInvoiceScope(invoice, scopeReaderFor(ctx), ctx.principal);
  return invoice;
};

/**
 * The invoice as this caller may see it.
 *
 * `techSeesPrice` is read only for technicians — owner/office are never redacted, and skipping the
 * query for them keeps the office path exactly as cheap as it was.
 */
const present = async (invoice: Invoice, ctx: FieldCtx) => {
  const orgId: OrgId = ctx.principal.orgId;
  const jobId = invoice.props.sourceJobId;
  const [leads, serviceAt, seesPrice] = await Promise.all([
    new DrizzleLeadRepository(ctx.tx, orgId).findByIds([invoice.props.leadId]),
    // The close-out document states WHEN the work was done, from the same reader the office and
    // the customer's own page use. No source job, no completed visit — no date, never a fallback.
    jobId ? new DrizzleServiceDateReader(ctx.tx, orgId).forJob(jobId) : Promise.resolve(null),
    ctx.principal.role === "tech"
      ? new DrizzleSettingsRepository(ctx.tx, orgId).getTechSeesPrice()
      : Promise.resolve(true),
  ]);
  return toFieldInvoiceDTO(
    invoice,
    {
      customerName: leads[0]?.props.name ?? null,
      serviceAddress: leads[0]?.props.address ?? null,
      serviceAt,
    },
    seesPrice,
  );
};
