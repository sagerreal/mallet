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
import type { Invoice } from "../domain/invoice";
import { PAYMENT_METHODS, type PaymentMethod } from "../domain/payment";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleJobReader } from "../infra/drizzle-job-reader";
import { DrizzleEstimateDepositReader } from "../infra/drizzle-estimate-deposit-reader";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { DrizzleFieldScopeReader } from "../infra/drizzle-field-scope-reader";
import { DrizzleVisitFeeReader } from "../infra/drizzle-visit-fee-reader";
import { ManualPaymentGateway } from "../infra/manual-payment-gateway";
import { CreateInvoiceFromJobUseCase } from "../app/create-invoice-from-job";
import { CreatePaymentUseCase } from "../app/create-payment";
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

const invoiceIdInput = z.object({ invoiceId: z.string().uuid() });
const jobIdInput = z.object({
  jobId: z.string().uuid(),
  // Client-authored id for the NEW row so the store's optimistic id matches the persisted one
  // (same convention as the office endpoints). The idempotent path ignores it.
  id: z.string().uuid().optional(),
});
const recordPaymentInput = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  method: methodEnum,
  idempotencyKey: z.string().min(8),
});

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
      .input(jobIdInput)
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
          await useCase.exec({
            orgId: ctx.principal.orgId,
            jobId,
            id: input.id ? asInvoiceId(input.id) : undefined,
          }),
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
            idempotencyKey: input.idempotencyKey,
            recordedByUserId: ctx.principal.userId,
          }),
        );
        return present(invoice, ctx);
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
      .output(z.object({ url: z.string().url() }))
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
        return { url: result.url };
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
  const leads = await new DrizzleLeadRepository(ctx.tx, orgId).findByIds([invoice.props.leadId]);
  const customerName = leads[0]?.props.name ?? null;
  const seesPrice =
    ctx.principal.role === "tech"
      ? await new DrizzleSettingsRepository(ctx.tx, orgId).getTechSeesPrice()
      : true;
  return toFieldInvoiceDTO(invoice, customerName, seesPrice);
};
