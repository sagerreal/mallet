import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { Phone, isOk, toPage } from "@mallet/shared/types";
import { DrizzleLeadRepository } from "../infra/drizzle-lead-repository";
import { EnsureCustomerUseCase } from "../app/ensure-customer";
import { ListLeadsUseCase } from "../app/list-leads";
import { LEAD_STAGES, type Lead, type LeadStage } from "../domain/lead";

// DTOs — the wire contract, deliberately separate from the domain. Money is flattened to a
// plain cents object; Phone/branded ids serialize as strings.
const stageEnum = z.enum(LEAD_STAGES as unknown as [LeadStage, ...LeadStage[]]);
const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

const leadDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  source: z.string().nullable(),
  stage: stageEnum,
  value: moneyDTO,
  unread: z.boolean(),
  createdAt: z.string(),
});

const createInput = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  source: z.string().optional(),
});

const listInput = z.object({
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().nullish(),
  stage: stageEnum.optional(),
  unreadOnly: z.boolean().optional(),
});

const paginatedLeadDTO = z.object({
  items: z.array(leadDTO),
  nextCursor: z.string().nullable(),
});

const toLeadDTO = (lead: Lead) => {
  const p = lead.props;
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    email: p.email,
    source: p.source,
    stage: p.stage,
    value: { cents: p.value, currency: "USD" as const },
    unread: p.unread,
    createdAt: p.createdAt.toISOString(),
  };
};

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createLeadRouter = () =>
  router({
    create: ownerOrOffice
      .input(createInput)
      .output(leadDTO)
      .mutation(async ({ ctx, input }) => {
        let phone: Phone | null = null;
        if (input.phone) {
          const parsed = Phone.parse(input.phone);
          if (!isOk(parsed)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.message });
          }
          phone = parsed.value;
        }
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new EnsureCustomerUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        const result = await useCase.exec({
          name: input.name,
          phone,
          email: input.email ?? null,
          source: input.source ?? null,
        });
        return toLeadDTO(orThrow(result));
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedLeadDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListLeadsUseCase(repo);
        const page = await useCase.exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { stage: input.stage, unreadOnly: input.unreadOnly },
        });
        return { items: page.items.map(toLeadDTO), nextCursor: page.nextCursor };
      }),
  });
