import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asCompanyId, toPage } from "@mallet/shared/types";
import { DrizzleCompanyRepository } from "../infra/drizzle-company-repository";
import { CreateCompanyUseCase } from "../app/create-company";
import { ListCompaniesUseCase } from "../app/list-companies";
import { UpdateCompanyUseCase } from "../app/update-company";
import { ArchiveCompanyUseCase } from "../app/archive-company";
import { companyDTO, toCompanyDTO } from "./company-dto";

const paginatedCompanyDTO = z.object({
  items: z.array(companyDTO),
  nextCursor: z.string().nullable(),
});

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});

const createInput = z.object({
  // Client may author the id for optimistic UI (mirrors createTask/createVisit pattern).
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(500),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  website: z.string().max(2048).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

const updateInput = z.object({
  companyId: z.string().uuid(),
  name: z.string().min(1).max(500).optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().max(320).nullable().optional(),
  website: z.string().max(2048).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});

const archiveInput = z.object({
  companyId: z.string().uuid(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createCompanyRouter = () =>
  router({
    list: ownerOrOffice
      .input(listInput)
      .output(paginatedCompanyDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListCompaniesUseCase(repo);
        const page = await useCase.exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        });
        return { items: page.items.map(toCompanyDTO), nextCursor: page.nextCursor };
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(companyDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateCompanyUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            name: input.name,
            phone: input.phone ?? null,
            email: input.email ?? null,
            website: input.website ?? null,
            address: input.address ?? null,
            notes: input.notes ?? null,
          },
          ctx.principal.orgId,
        );
        return toCompanyDTO(orThrow(result));
      }),

    update: ownerOrOffice
      .input(updateInput)
      .output(companyDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateCompanyUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            companyId: asCompanyId(input.companyId),
            name: input.name,
            phone: input.phone,
            email: input.email,
            website: input.website,
            address: input.address,
            notes: input.notes,
          },
          ctx.principal.orgId,
        );
        return toCompanyDTO(orThrow(result));
      }),

    archive: ownerOrOffice
      .input(archiveInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleCompanyRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveCompanyUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { companyId: asCompanyId(input.companyId) },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),
  });
