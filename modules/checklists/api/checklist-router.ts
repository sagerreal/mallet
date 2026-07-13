import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asChecklistId, asChecklistItemId, toPage } from "@mallet/shared/types";
import { DrizzleChecklistRepository } from "../infra/drizzle-checklist-repository";
import { CreateChecklistUseCase } from "../app/create-checklist";
import { ListChecklistsUseCase } from "../app/list-checklists";
import { ArchiveChecklistUseCase } from "../app/archive-checklist";
import { AddItemUseCase } from "../app/add-item";
import { RemoveItemUseCase } from "../app/remove-item";
import { SetItemRequiredUseCase } from "../app/set-item-required";
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

const addItemInput = z.object({
  checklistId: z.string().uuid(),
  id: z.string().uuid().optional(),
  text: z.string().min(1).max(500),
  type: z.enum(["check", "photo"]),
});

const removeItemInput = z.object({
  checklistId: z.string().uuid(),
  itemId: z.string().uuid(),
});

const setItemRequiredInput = z.object({
  checklistId: z.string().uuid(),
  itemId: z.string().uuid(),
  required: z.boolean(),
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

    addItem: ownerOrOffice
      .input(addItemInput)
      .output(checklistDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddItemUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          { checklistId: asChecklistId(input.checklistId), id: input.id, text: input.text, type: input.type },
          ctx.principal.orgId,
        );
        return toChecklistDTO(orThrow(result));
      }),

    removeItem: ownerOrOffice
      .input(removeItemInput)
      .output(checklistDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveItemUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { checklistId: asChecklistId(input.checklistId), itemId: asChecklistItemId(input.itemId) },
          ctx.principal.orgId,
        );
        return toChecklistDTO(orThrow(result));
      }),

    setItemRequired: ownerOrOffice
      .input(setItemRequiredInput)
      .output(checklistDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleChecklistRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetItemRequiredUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { checklistId: asChecklistId(input.checklistId), itemId: asChecklistItemId(input.itemId), required: input.required },
          ctx.principal.orgId,
        );
        return toChecklistDTO(orThrow(result));
      }),
  });
