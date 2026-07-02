import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asEstimateId, asLeadId, toPage } from "@mallet/shared/types";
import { ESTIMATE_STATUSES, type Estimate, type EstimateStatus } from "../domain/estimate";
import { DrizzleEstimateRepository } from "../infra/drizzle-estimate-repository";
import { DraftEstimateUseCase } from "../app/draft-estimate";
import { SendEstimateUseCase } from "../app/send-estimate";
import { AcceptEstimateUseCase } from "../app/accept-estimate";
import { DeclineEstimateUseCase } from "../app/decline-estimate";
import { ListEstimatesUseCase } from "../app/list-estimates";

const statusEnum = z.enum(ESTIMATE_STATUSES as unknown as [EstimateStatus, ...EstimateStatus[]]);
const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

const estimateLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  isOptional: z.boolean(),
  needsPhoto: z.boolean(),
  position: z.number().int(),
});

const estimateDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  status: statusEnum,
  discBps: z.number().int(),
  taxBps: z.number().int(),
  depBps: z.number().int(),
  lines: z.array(estimateLineDTO),
  subtotal: moneyDTO,
  discount: moneyDTO,
  tax: moneyDTO,
  total: moneyDTO,
  depositDue: moneyDTO,
  validDays: z.number().int().nullable(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  declinedAt: z.string().nullable(),
  declineReason: z.string().nullable(),
  createdAt: z.string(),
});

// Lighter shape for list views — no line detail, but the derived total for display.
const estimateSummaryDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  status: statusEnum,
  total: moneyDTO,
  createdAt: z.string(),
});

const lineInput = z.object({
  description: z.string().min(1),
  quantity: z.number().nonnegative(),
  rateCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().optional(),
  isOptional: z.boolean().optional(),
  needsPhoto: z.boolean().optional(),
});

const draftInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().optional(),
  discBps: z.number().int().min(0).max(10_000).optional(),
  taxBps: z.number().int().min(0).optional(),
  depBps: z.number().int().min(0).max(10_000).optional(),
  validDays: z.number().int().positive().optional(),
  lines: z.array(lineInput).min(1),
});

const listInput = z.object({
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().nullish(),
  status: statusEnum.optional(),
});

const idInput = z.object({ estimateId: z.string().uuid() });
const declineInput = z.object({ estimateId: z.string().uuid(), reason: z.string().min(1) });
const listByLeadInput = z.object({
  leadId: z.string().uuid(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().nullish(),
});
const paginatedSummaryDTO = z.object({
  items: z.array(estimateSummaryDTO),
  nextCursor: z.string().nullable(),
});

const money = (cents: number) => ({ cents, currency: "USD" as const });

const toEstimateDTO = (estimate: Estimate) => {
  const p = estimate.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    discBps: p.discBps,
    taxBps: p.taxBps,
    depBps: p.depBps,
    lines: p.lines.map((line) => {
      const lp = line.props;
      return {
        id: lp.id,
        description: lp.description,
        quantity: lp.quantity,
        rate: money(lp.rate),
        cost: money(lp.cost),
        isOptional: lp.isOptional,
        needsPhoto: lp.needsPhoto,
        position: lp.position,
      };
    }),
    subtotal: money(estimate.subtotal()),
    discount: money(estimate.discountAmount()),
    tax: money(estimate.taxAmount()),
    total: money(estimate.total()),
    depositDue: money(estimate.depositDue()),
    validDays: p.validDays,
    sentAt: p.sentAt?.toISOString() ?? null,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    declineReason: p.declineReason,
    createdAt: p.createdAt.toISOString(),
  };
};

const toSummaryDTO = (estimate: Estimate) => {
  const p = estimate.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    total: money(estimate.total()),
    createdAt: p.createdAt.toISOString(),
  };
};

// Layer 5: thin transport. Build the org-scoped use-case from the request's tx + ports, delegate,
// map the result. No business logic here.
export const createEstimateRouter = () =>
  router({
    draft: ownerOrOffice
      .input(draftInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DraftEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          leadId: asLeadId(input.leadId),
          title: input.title ?? null,
          discBps: input.discBps ?? 0,
          taxBps: input.taxBps ?? 0,
          depBps: input.depBps ?? 0,
          validDays: input.validDays ?? null,
          lines: input.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            rateCents: line.rateCents,
            costCents: line.costCents ?? 0,
            isOptional: line.isOptional ?? false,
            needsPhoto: line.needsPhoto ?? false,
          })),
        });
        return toEstimateDTO(orThrow(result));
      }),

    get: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const estimate = await repo.findById(asEstimateId(input.estimateId));
        if (!estimate) throw new TRPCError({ code: "NOT_FOUND", message: "estimate not found" });
        return toEstimateDTO(estimate);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListEstimatesUseCase(repo);
        const page = await useCase.exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { status: input.status },
        });
        return { items: page.items.map(toSummaryDTO), nextCursor: page.nextCursor };
      }),

    listByLead: ownerOrOffice
      .input(listByLeadInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.listByLead(
          asLeadId(input.leadId),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        return { items: page.items.map(toSummaryDTO), nextCursor: page.nextCursor };
      }),

    send: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SendEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toEstimateDTO(orThrow(await useCase.exec({ estimateId: asEstimateId(input.estimateId) })));
      }),

    accept: ownerOrOffice
      .input(idInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AcceptEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toEstimateDTO(orThrow(await useCase.exec({ estimateId: asEstimateId(input.estimateId) })));
      }),

    decline: ownerOrOffice
      .input(declineInput)
      .output(estimateDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DeclineEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toEstimateDTO(
          orThrow(await useCase.exec({ estimateId: asEstimateId(input.estimateId), reason: input.reason })),
        );
      }),
  });
