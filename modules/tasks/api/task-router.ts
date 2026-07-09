import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asTaskId, asLeadId, toPage } from "@mallet/shared/types";
import { DrizzleTaskRepository } from "../infra/drizzle-task-repository";
import { CreateTaskUseCase } from "../app/create-task";
import { ListTasksUseCase } from "../app/list-tasks";
import { SetTaskDoneUseCase } from "../app/set-task-done";
import { UpdateTaskUseCase } from "../app/update-task";
import { RemoveTaskUseCase } from "../app/remove-task";
import { taskDTO, toTaskDTO } from "./task-dto";

const paginatedTaskDTO = z.object({
  items: z.array(taskDTO),
  nextCursor: z.string().nullable(),
});

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  done: z.boolean().optional(),
  leadId: z.string().uuid().optional(),
});

const createInput = z.object({
  // Client may author the id (mirrors createVisit pattern for optimistic UI).
  id: z.string().uuid().optional(),
  text: z.string().min(1).max(2000),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
});

const setDoneInput = z.object({
  taskId: z.string().uuid(),
  done: z.boolean(),
});

const updateInput = z.object({
  taskId: z.string().uuid(),
  text: z.string().min(1).max(2000).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
});

const removeInput = z.object({
  taskId: z.string().uuid(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here.
export const createTaskRouter = () =>
  router({
    list: ownerOrOffice
      .input(listInput)
      .output(paginatedTaskDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleTaskRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListTasksUseCase(repo);
        const page = await useCase.exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: {
            done: input.done,
            leadId: input.leadId ? asLeadId(input.leadId) : undefined,
          },
        });
        return { items: page.items.map(toTaskDTO), nextCursor: page.nextCursor };
      }),

    create: ownerOrOffice
      .input(createInput)
      .output(taskDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTaskRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateTaskUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            text: input.text,
            dueDate: input.dueDate ?? null,
            leadId: input.leadId ? asLeadId(input.leadId) : null,
          },
          ctx.principal.orgId,
        );
        return toTaskDTO(orThrow(result));
      }),

    setDone: ownerOrOffice
      .input(setDoneInput)
      .output(taskDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTaskRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetTaskDoneUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { taskId: asTaskId(input.taskId), done: input.done },
          ctx.principal.orgId,
        );
        return toTaskDTO(orThrow(result));
      }),

    update: ownerOrOffice
      .input(updateInput)
      .output(taskDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTaskRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateTaskUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            taskId: asTaskId(input.taskId),
            text: input.text,
            dueDate: input.dueDate,
            leadId: input.leadId !== undefined
              ? input.leadId !== null
                ? asLeadId(input.leadId)
                : null
              : undefined,
          },
          ctx.principal.orgId,
        );
        return toTaskDTO(orThrow(result));
      }),

    remove: ownerOrOffice
      .input(removeInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTaskRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveTaskUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { taskId: asTaskId(input.taskId) },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),
  });
