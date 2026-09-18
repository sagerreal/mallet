import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asChecklistId, toPage } from "@mallet/shared/types";
import { DrizzleChecklistRepository } from "../infra/drizzle-checklist-repository";
import { CreateChecklistUseCase } from "../app/create-checklist";
import { ListChecklistsUseCase } from "../app/list-checklists";
import { ArchiveChecklistUseCase } from "../app/archive-checklist";
import { UpdateChecklistUseCase } from "../app/update-checklist";
import { checklistDTO, toChecklistDTO } from "./checklist-dto";

const paginatedChecklistDTO = z.object({
  items: z.array(checklistDTO),
  nextCursor: z.string().nullable(),
});

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});

const createInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(200),
  trade: z.string().max(80).optional(),
  stage: z.enum(["job", "scope"]),
  match: z.array(z.string().max(120)).max(50).optional(),
  // Initial items, created atomically with the template — a pasted list is ONE
  // mutation (batched create + addItem calls raced server-side).
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        text: z.string().min(1).max(500),
        type: z.enum(["check", "photo"]),
        required: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
});

const removeInput = z.object({ checklistId: z.string().uuid() });

const updateInput = z.object({
  checklistId: z.string().uuid(),
  name: z.string().min(1).max(200),
  items: z
    .array(
      z.object({
        text: z.string().min(1).max(500),
        type: z.enum(["check", "photo"]),
        required: z.boolean().optional(),
      }),
    )
    .max(50),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createChecklistRouter = () =>
  router({
    list: ownerOrOffice
      .input(listInput)
      .output(paginatedChecklistDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListChecklistsUseCase(repo);
        const page = await useCase.exec({ page: toPage({ limit: input.limit, cursor: input.cursor ?? null }) });
        return { items: page.items.map(toChecklistDTO), nextCursor: page.nextCursor };
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(checklistDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateChecklistUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            name: input.name,
            trade: input.trade ?? "Custom",
            stage: input.stage,
            match: input.match ?? [],
            items: input.items ?? [],
          },
          ctx.principal.orgId,
        );
        return toChecklistDTO(orThrow(result));
      }),

    remove: ownerOrOffice
      .input(removeInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveChecklistUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec({ checklistId: asChecklistId(input.checklistId) }, ctx.principal.orgId);
        return orThrow(result);
      }),

    update: ownerOrOffice
      .input(updateInput)
      .output(checklistDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateChecklistUseCase(repo, ctx.deps.ids);
        const result = await useCase.exec(
          {
            checklistId: input.checklistId,
            name: input.name,
            items: input.items,
          },
          ctx.principal.orgId,
        );
        return toChecklistDTO(orThrow(result));
      }),

    // Item-level mutations (addItem / removeItem / setItemRequired) were removed
    // 2026-07-13: zero client callers after the paste-a-list rebuild, and they
    // contradicted the "delete/recreate whole, never patch" checklist contract
    // (checklists-slice.ts). Templates are created atomically with their items.
  });
