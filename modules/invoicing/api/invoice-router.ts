import { z } from "zod";
import type { TenantTx } from "@mallet/shared/db/tx";
import { DrizzleAuthorizationReader } from "../infra/drizzle-authorization-reader";
import { checkAuthorization } from "../domain/authorization";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asInvoiceId, asJobId, asLeadId, money, toPage } from "@mallet/shared/types";
import type { OrgId } from "@mallet/shared/types";
import { INVOICE_STATUSES, type Invoice, type InvoiceStatus } from "../domain/invoice";
import { PAYMENT_METHODS, type PaymentMethod } from "../domain/payment";
import { DrizzleInvoiceRepository } from "../infra/drizzle-invoice-repository";
import { DrizzleLeadRepository } from "@mallet/customers";
import { INVOICE_SORTS } from "../infra/invoice-sorts";
import { INVOICE_VIEWS } from "../infra/invoice-views";
import { DrizzleJobReader } from "../infra/drizzle-job-reader";
import { DrizzleEstimateDepositReader } from "../infra/drizzle-estimate-deposit-reader";
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
const viewEnum = z.enum(INVOICE_VIEWS);
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
  /**
   * What the customer signed, and whether this bill stays inside it. Null when nothing was signed.
   *
   * RESOLVED on read from invoice → job → estimate, never stored on the invoice. A copy would be a
   * third place for the signed amount to live and a third place for it to drift.
   *
   * `overage` is set ONLY when a signature exists and the bill exceeds it. An unsigned invoice
   * carries authorization: null and no overage — no signed amount means nothing to exceed, and
   * warning there would train people to dismiss a banner that has to stay rare to mean anything.
   */
  authorization: z
    .object({
      source: z.enum(["job", "estimate"]),
      signerName: z.string(),
      signedAt: z.string(),
      documentRef: z.string(),
      authorizedCents: z.number().int(),
      overage: z
        .object({ authorizedCents: z.number().int(), invoicedCents: z.number().int(), excessCents: z.number().int() })
        .nullable(),
    })
    .nullable(),
  leadId: z.string().uuid(),
  /**
   * The customer's name, resolved SERVER-side — nullable only when the lead is gone.
   *
   * Same reasoning as the summary DTO. The invoice sheet read this out of the store's leads
   * collection, which works only while every lead is loaded; the ledger pages through the
   * database, so an invoice opened from a later page showed a blank customer.
   */
  customerName: z.string().nullable(),
  title: z.string().nullable(),
  status: statusEnum,
  /** Tax-INCLUSIVE — `tax` says how much of it is tax, it is not added on top. */
  total: moneyDTO,
  taxBps: z.number().int().min(0),
  tax: moneyDTO,
  depositPaid: moneyDTO,
  amountPaid: moneyDTO,
  due: moneyDTO,
  termsDays: z.number().int(),
  lines: z.array(lineDTO),
  payments: z.array(paymentDTO),
  sentAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  // Is the shop still chasing this one, and how many nudges in.
  followUpOn: z.boolean(),
  followUpStage: z.number().int(),
  createdAt: z.string(),
});
const summaryDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  /**
   * The customer's name, resolved SERVER-side.
   *
   * The ledger looked this up in the store's leads collection, which works only while every lead
   * is loaded — and leads hit the same page ceiling as invoices, so a paginated ledger would show
   * a blank customer for every row past the first page.
   */
  customerName: z.string().nullable(),
  /**
   * The customer's phone, resolved SERVER-side.
   *
   * The home queue drafts a TEXT to this person. It was reading the phone off the store's leads
   * collection, which holds one page — so a reminder for a customer outside it rendered "No phone
   * number yet" and asked the owner to type in a number the shop already had.
   */
  customerPhone: z.string().nullable(),
  title: z.string().nullable(),
  status: statusEnum,
  total: moneyDTO,
  due: moneyDTO,
  dueAt: z.string().nullable(),
  // Is the shop still chasing this one, and how many nudges in.
  followUpOn: z.boolean(),
  followUpStage: z.number().int(),
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
  // Client-authored id — preserved so the store's optimistic id matches the persisted row.
  id: z.string().uuid().optional(),
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
  /** Named sort — never a column name. Absent keeps the historical newest-first ordering. */
  sort: z.enum(INVOICE_SORTS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  /** Restrict to money still owed — the collection queue. */
  unpaidOnly: z.boolean().optional(),
  /** Free-text over invoice number, title and customer name. */
  search: z.string().trim().min(1).max(200).optional(),
  /** The ledger band shown on the Money screen — see invoice-views.ts. Not the status column. */
  view: viewEnum.optional(),
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

/**
 * The invoice DTO plus its resolved authorisation.
 *
 * Every path that returns a FULL invoice goes through here, not just `get`. If a mutation returned
 * the bare DTO the client would reconcile `authorization: null` over a real one and the overage
 * banner would vanish the moment someone edited a line — which is exactly when it matters most.
 *
 * The list path does NOT use this: it returns a different summary shape, and resolving per row
 * would be an N+1 across the whole page.
 */
const toInvoiceDTOWithAuth = async (
  invoice: Invoice,
  tx: TenantTx,
  orgId: OrgId,
): Promise<
  ReturnType<typeof toInvoiceDTO> & { customerName: string | null; authorization: InvoiceAuthorizationDTO }
> => {
  // The customer's name, resolved here rather than looked up in the browser's store — the ledger
  // pages through the database, so the store cannot be relied on to hold this invoice's lead.
  const leads = await new DrizzleLeadRepository(tx, orgId).findByIds([invoice.props.leadId]);
  const customerName = leads[0]?.props.name ?? null;
  const base = { ...toInvoiceDTO(invoice), customerName };
  const jobId = invoice.props.sourceJobId;
  if (!jobId) return { ...base, authorization: null };

  const auth = await new DrizzleAuthorizationReader(tx, orgId).forJob(jobId);
  const checked = checkAuthorization({
    invoiceId: invoice.props.id,
    invoiceTotalCents: invoice.props.total,
    authorization: auth,
  });
  if (!checked.authorization) return { ...base, authorization: null };
  return {
    ...base,
    authorization: {
      source: checked.authorization.source,
      signerName: checked.authorization.signerName,
      signedAt: checked.authorization.signedAt.toISOString(),
      documentRef: checked.authorization.documentRef,
      authorizedCents: checked.authorization.authorizedCents,
      overage: checked.overage
        ? {
            authorizedCents: checked.overage.authorizedCents,
            invoicedCents: checked.overage.invoicedCents,
            excessCents: checked.overage.excessCents,
          }
        : null,
    },
  };
};

type InvoiceAuthorizationDTO = z.infer<typeof invoiceDTO>["authorization"];

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
    taxBps: p.taxBps,
    tax: money$(p.tax),
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
    followUpOn: p.followUpOn ?? false,
    followUpStage: p.followUpStage ?? 0,
    createdAt: p.createdAt.toISOString(),
  };
};

const toSummaryDTO = (
  invoice: Invoice,
  customerName: string | null = null,
  customerPhone: string | null = null,
) => {
  const p = invoice.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    customerName,
    customerPhone,
    title: p.title,
    status: p.status,
    total: money$(p.total),
    due: money$(invoice.due()),
    dueAt: iso(p.dueAt),
    followUpOn: p.followUpOn ?? false,
    followUpStage: p.followUpStage ?? 0,
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
          id: input.id ? asInvoiceId(input.id) : undefined,
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
        return toInvoiceDTOWithAuth(orThrow(result), ctx.tx, ctx.principal.orgId);
      }),

    createFromJob: ownerOrOffice
      // Client-authored id — preserved for the NEW row so the store's optimistic id matches the
      // persisted row (same convention as draftInput). The idempotent path ignores it.
      .input(z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional() }))
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const jobs = new DrizzleJobReader(ctx.tx, ctx.principal.orgId);
        const deposits = new DrizzleEstimateDepositReader(ctx.tx);
        const useCase = new CreateInvoiceFromJobUseCase(
          repo,
          jobs,
          deposits,
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toInvoiceDTOWithAuth(
          orThrow(
            await useCase.exec({
              orgId: ctx.principal.orgId,
              jobId: asJobId(input.jobId),
              id: input.id ? asInvoiceId(input.id) : undefined,
            }),
          ),
          ctx.tx,
          ctx.principal.orgId,
        );
      }),

    send: ownerOrOffice
      .input(idInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SendInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTOWithAuth(orThrow(await useCase.exec({ invoiceId: asInvoiceId(input.invoiceId) })), ctx.tx, ctx.principal.orgId);
      }),

    recordPayment: ownerOrOffice
      .input(recordPaymentInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const gateway = new ManualPaymentGateway(ctx.deps.clock);
        const useCase = new RecordPaymentUseCase(repo, gateway, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toInvoiceDTOWithAuth(
          orThrow(
            await useCase.exec({
              orgId: ctx.principal.orgId,
              invoiceId: asInvoiceId(input.invoiceId),
              amount: money(input.amountCents),
              method: input.method,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
          ctx.tx,
          ctx.principal.orgId,
        );
      }),

    void: ownerOrOffice
      .input(idInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new VoidInvoiceUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTOWithAuth(orThrow(await useCase.exec({ invoiceId: asInvoiceId(input.invoiceId) })), ctx.tx, ctx.principal.orgId);
      }),

    updateMetadata: ownerOrOffice
      .input(updateMetadataInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateInvoiceMetadataUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toInvoiceDTOWithAuth(
          orThrow(
            await useCase.exec({
              invoiceId: asInvoiceId(input.invoiceId),
              leadId: input.leadId ? asLeadId(input.leadId) : undefined,
              title: input.title,
              termsDays: input.termsDays,
              depositPaidCents: input.depositPaidCents,
            }),
          ),
          ctx.tx,
          ctx.principal.orgId,
        );
      }),

    /** Chasing this invoice: on/off plus how many nudges have gone out. Was client-local, so the
     *  switch read back OFF after a refetch whatever the user had set. */
    setFollowUp: ownerOrOffice
      .input(z.object({
        invoiceId: z.string().uuid(),
        on: z.boolean(),
        stage: z.number().int().min(0).max(10),
      }))
      .output(z.object({ ok: z.literal(true) }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const invoice = await repo.findById(asInvoiceId(input.invoiceId));
        if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "invoice not found" });
        const next = invoice.setFollowUp(input.on, input.stage, ctx.deps.clock.now());
        if (!next.ok) throw new TRPCError({ code: "BAD_REQUEST", message: next.error.message });
        await repo.save(next.value);
        return { ok: true as const };
      }),

    patchLines: ownerOrOffice
      .input(patchLinesInput)
      .output(invoiceDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new PatchInvoiceLinesUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toInvoiceDTOWithAuth(
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
          ctx.tx,
          ctx.principal.orgId,
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
        return toInvoiceDTOWithAuth(invoice, ctx.tx, ctx.principal.orgId);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        const page = await new ListInvoicesUseCase(repo).exec({
          sort: input.sort,
          sortDir: input.sortDir,
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { status: input.status, unpaidOnly: input.unpaidOnly, search: input.search, view: input.view },
        });
        // One batched lead read for the page — never a per-row query. Same pattern the jobs list
        // uses, and for the same reason: the store cannot be relied on to hold these leads.
        const names = await new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).findByIds(
          [...new Set(page.items.map((i) => i.props.leadId))],
        );
        const leadById = new Map<string, { name: string; phone: string | null }>(
          names.map((l: { props: { id: string; name: string; phone?: string | null } }) => [
            String(l.props.id),
            { name: l.props.name, phone: l.props.phone ?? null },
          ]),
        );
        return {
          items: page.items.map((i) => {
            const lead = leadById.get(String(i.props.leadId));
            return toSummaryDTO(i, lead?.name ?? null, lead?.phone ?? null);
          }),
          nextCursor: page.nextCursor,
        };
      }),

    /**
     * What the shop is owed, and how much of it is late — for the whole book.
     *
     * Its own endpoint rather than a field on `count`, because a filtered count answers "how many
     * of these" while this answers "how much, across everything", and folding the two together
     * would invite a caller to pass a filter that silently does not apply.
     */
    totals: ownerOrOffice
      .output(
        z.object({
          openCents: z.number().int(),
          overdueCents: z.number().int(),
          openCount: z.number().int(),
        }),
      )
      .query(async ({ ctx }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        return repo.totals();
      }),

    /** The TRUE number of invoices matching a filter — shares list()'s predicates. */
    count: ownerOrOffice
      .input(
        z.object({
          status: statusEnum.optional(),
          unpaidOnly: z.boolean().optional(),
          search: z.string().trim().min(1).max(200).optional(),
          view: viewEnum.optional(),
        }),
      )
      .output(z.object({ total: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.principal.orgId);
        return {
          total: await repo.count({
            status: input.status,
            unpaidOnly: input.unpaidOnly,
            search: input.search,
            view: input.view,
          }),
        };
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
        return { items: page.items.map((i) => toSummaryDTO(i)), nextCursor: page.nextCursor };
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
        return { items: page.items.map((i) => toSummaryDTO(i)), nextCursor: page.nextCursor };
      }),
  });
