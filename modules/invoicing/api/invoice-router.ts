import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asInvoiceId, asJobId, asLeadId, money, toPage } from "@mallet/shared/types";
import { INVOICE_STATUSES, type Invoice, type InvoiceStatus } from "../domain/invoice";
import { PAYMENT_METHODS, type PaymentMethod } from "../domain/payment";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleJobReader } from "../infra/drizzle-job-reader";
import { DrizzleConnectTargetReader } from "../infra/drizzle-connect-target-reader";
import { ManualPaymentGateway } from "../infra/manual-payment-gateway";
import { DraftInvoiceUseCase } from "../app/draft-invoice";
import { CreateInvoiceFromJobUseCase } from "../app/create-invoice-from-job";
import { CreatePaymentUseCase } from "../app/create-payment";
import { SendInvoiceUseCase } from "../app/send-invoice";
import { RecordPaymentUseCase } from "../app/record-payment";
import { VoidInvoiceUseCase } from "../app/void-invoice";
import { ListInvoicesUseCase } from "../app/list-invoices";
import { UpdateInvoiceMetadataUseCase } from "../app/update-invoice-metadata";
import { PatchInvoiceLinesUseCase } from "../app/patch-invoice-lines";

const statusEnum = z.enum(INVOICE_STATUSES as unknown as [InvoiceStatus, ...InvoiceStatus[]]);
const methodEnum = z.enum(PAYMENT_METHODS as unknown as [PaymentMethod, ...PaymentMethod[]]);
const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

const lineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  position: z.number().int(),
});
const paymentDTO = z.object({
  id: z.string().uuid(),
  amount: moneyDTO,
  method: methodEnum,
  receivedAt: z.string(),
});
const invoiceDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  sourceJobId: z.string().uuid().nullable(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  status: statusEnum,
  total: moneyDTO,
  depositPaid: moneyDTO,
  amountPaid: moneyDTO,
  due: moneyDTO,
  termsDays: z.number().int(),
  lines: z.array(lineDTO),
  payments: z.array(paymentDTO),
  sentAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  createdAt: z.string(),
});
const summaryDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  status: statusEnum,
  total: moneyDTO,
  due: moneyDTO,
  dueAt: z.string().nullable(),
  createdAt: z.string(),
});
const paginatedSummaryDTO = z.object({
  items: z.array(summaryDTO),
  nextCursor: z.string().nullable(),
});

const lineInput = z.object({
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  rateCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().optional(),
});
const draftInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().optional(),
  termsDays: z.number().int().min(0).optional(),
  lines: z.array(lineInput).min(1),
});
const idInput = z.object({ invoiceId: z.string().uuid() });
const updateMetadataInput = z.object({
  invoiceId: z.string().uuid(),
  leadId: z.string().uuid().optional(),
  title: z.string().max(500).nullable().optional(),
  termsDays: z.number().int().min(0).optional(),
  depositPaidCents: z.number().int().nonnegative().optional(),
});
const patchLinesInput = z.object({
  invoiceId: z.string().uuid(),
  // empty array clears all lines — deliberately NOT .min(1) like draftInput.
  lines: z.array(lineInput),
});
const recordPaymentInput = z.object({
  invoiceId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  method: methodEnum,
  idempotencyKey: z.string().min(8),
});
const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  status: statusEnum.optional(),
});
const listByLeadInput = z.object({
  leadId: z.string().uuid(),
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});
const cursorInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});

const money$ = (cents: number) => ({ cents, currency: "USD" as const });
const iso = (d: Date | null) => d?.toISOString() ?? null;

const toInvoiceDTO = (invoice: Invoice) => {
  const p = invoice.props;
  return {
    id: p.id,
    num: p.num,
    sourceJobId: p.sourceJobId,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    total: money$(p.total),
    depositPaid: money$(p.depositPaid),
    amountPaid: money$(p.amountPaid),
    due: money$(invoice.due()),
    termsDays: p.termsDays,
    lines: p.lines.map((line) => ({
      id: line.props.id,
      description: line.props.description,
      quantity: line.props.quantity,
      rate: money$(line.props.rate),
      cost: money$(line.props.cost),
      position: line.props.position,
    })),
    payments: p.payments.map((pay) => ({
      id: pay.props.id,
      amount: money$(pay.props.amount),
      method: pay.props.method,
      receivedAt: pay.props.receivedAt.toISOString(),
    })),
    sentAt: iso(p.sentAt),
    dueAt: iso(p.dueAt),
    createdAt: p.createdAt.toISOString(),
  };
};

const toSummaryDTO = (invoice: Invoice) => {
  const p = invoice.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    total: money$(p.total),
    due: money$(invoice.due()),
    dueAt: iso(p.dueAt),
    createdAt: p.createdAt.toISOString(),
  };
};

// Layer 5: thin transport. Build org-scoped use-cases from the request's tx + ports, delegate,
// map the result. No business logic here.
export const createInvoiceRouter = () =>
  router({
    draft: ownerOrOffice
      .input(draftInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DraftInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          leadId: asLeadId(input.leadId),
          title: input.title ?? null,
          termsDays: input.termsDays ?? 7,
          lines: input.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            rateCents: l.rateCents,
            costCents: l.costCents ?? 0,
          })),
        });
        return toInvoiceDTO(orThrow(result));
      }),

    createFromJob: ownerOrOffice
      .input(z.object({ jobId: z.string().uuid() }))
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const jobs = new DrizzleJobReader(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateInvoiceFromJobUseCase(
          repo,
          jobs,
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toInvoiceDTO(
          orThrow(await useCase.exec({ orgId: ctx.principal.orgId, jobId: asJobId(input.jobId) })),
        );
      }),

    send: ownerOrOffice
      .input(idInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SendInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTO(orThrow(await useCase.exec({ invoiceId: asInvoiceId(input.invoiceId) })));
      }),

    recordPayment: ownerOrOffice
      .input(recordPaymentInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const gateway = new ManualPaymentGateway(ctx.deps.clock);
        const useCase = new RecordPaymentUseCase(repo, gateway, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toInvoiceDTO(
          orThrow(
            await useCase.exec({
              orgId: ctx.principal.orgId,
              invoiceId: asInvoiceId(input.invoiceId),
              amount: money(input.amountCents),
              method: input.method,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        );
      }),

    void: ownerOrOffice
      .input(idInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new VoidInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTO(orThrow(await useCase.exec({ invoiceId: asInvoiceId(input.invoiceId) })));
      }),

    updateMetadata: ownerOrOffice
      .input(updateMetadataInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateInvoiceMetadataUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTO(
          orThrow(
            await useCase.exec({
              invoiceId: asInvoiceId(input.invoiceId),
              leadId: input.leadId ? asLeadId(input.leadId) : undefined,
              title: input.title,
              termsDays: input.termsDays,
              depositPaidCents: input.depositPaidCents,
            }),
          ),
        );
      }),

    patchLines: ownerOrOffice
      .input(patchLinesInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new PatchInvoiceLinesUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toInvoiceDTO(
          orThrow(
            await useCase.exec({
              invoiceId: asInvoiceId(input.invoiceId),
              lines: input.lines.map((l) => ({
                description: l.description,
                quantity: l.quantity,
                rateCents: l.rateCents,
                costCents: l.costCents ?? 0,
              })),
            }),
          ),
        );
      }),

    // Create a Stripe-hosted payment link for the invoice balance (returns the URL to send the
    // customer). Disabled with PRECONDITION_FAILED when Stripe is not configured.
    createPayment: ownerOrOffice
      .input(idInput)
      .output(z.object({ url: z.string().url() }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.paymentLinkGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "card payments are not enabled" });
        }
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const connect = new DrizzleConnectTargetReader(ctx.tx, ctx.principal.orgId);
        const useCase = new CreatePaymentUseCase(repo, ctx.deps.paymentLinkGateway, connect);
        const result = orThrow(
          await useCase.exec({ orgId: ctx.principal.orgId, invoiceId: asInvoiceId(input.invoiceId) }),
        );
        return { url: result.url };
      }),

    get: ownerOrOffice
      .input(idInput)
      .output(invoiceDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const invoice = await repo.findById(asInvoiceId(input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "invoice not found" });
        return toInvoiceDTO(invoice);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const page = await new ListInvoicesUseCase(repo).exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { status: input.status },
        });
        return { items: page.items.map(toSummaryDTO), nextCursor: page.nextCursor };
      }),

    listByLead: ownerOrOffice
      .input(listByLeadInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.listByLead(
          asLeadId(input.leadId),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        return { items: page.items.map(toSummaryDTO), nextCursor: page.nextCursor };
      }),

    listOverdue: ownerOrOffice
      .input(cursorInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.findOverdue(
          ctx.deps.clock.now(),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        return { items: page.items.map(toSummaryDTO), nextCursor: page.nextCursor };
      }),
  });
