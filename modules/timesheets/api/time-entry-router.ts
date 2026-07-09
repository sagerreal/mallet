import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asTimeEntryId, asUserId, asJobId, toPage } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { DrizzleTimeEntryRepository } from "../infra/drizzle-time-entry-repository";
import { CreateTimeEntryUseCase } from "../app/create-time-entry";
import { ListTimeEntriesUseCase } from "../app/list-time-entries";
import { UpdateTimeEntryUseCase } from "../app/update-time-entry";
import { RemoveTimeEntryUseCase } from "../app/remove-time-entry";
import { ApproveWeekUseCase } from "../app/approve-week";
import { timeEntryDTO, toTimeEntryDTO } from "./time-entry-dto";

const paginatedDTO = z.object({
  items: z.array(timeEntryDTO),
  nextCursor: z.string().nullable(),
});

const listInput = z.object({
  techUserId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
});

const createInput = z.object({
  id: z.string().uuid().optional(),
  techUserId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  workDate: z.string().min(1),
  kind: z.enum(["job", "travel", "break", "shop"]),
  startTime: z.string().min(1),
  endTime: z.string().nullable().optional(),
  note: z.string().optional(),
  src: z.enum(["manual", "clock", "timer"]).optional(),
  running: z.boolean().optional(),
});

const updateInput = z.object({
  entryId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  workDate: z.string().optional(),
  kind: z.enum(["job", "travel", "break", "shop"]).optional(),
  startTime: z.string().optional(),
  endTime: z.string().nullable().optional(),
  note: z.string().optional(),
  src: z.enum(["manual", "clock", "timer"]).optional(),
  running: z.boolean().optional(),
});

const removeInput = z.object({
  entryId: z.string().uuid(),
});

const approveWeekInput = z.object({
  techUserId: z.string().uuid(),
  dates: z.array(z.string()).min(1),
});

const reopenInput = z.object({
  entryId: z.string().uuid(),
});

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here except the
// own-entry authz guard (tech may only touch their own entries; owner/office may touch any).
export const createTimesheetRouter = () =>
  router({
    list: anyRole
      .input(listInput)
      .output(paginatedDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListTimeEntriesUseCase(repo);

        // Tech callers may only list their own entries; override any techUserId they passed.
        const techUserId =
          ctx.principal.role === "tech"
            ? asUserId(ctx.principal.userId)
            : input.techUserId
              ? asUserId(input.techUserId)
              : undefined;

        const result = await useCase.exec({
          filter: {
            techUserId,
            fromDate: input.fromDate,
            toDate: input.toDate,
          },
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        });
        return { items: result.items.map(toTimeEntryDTO), nextCursor: result.nextCursor };
      }),

    create: anyRole
      .input(createInput)
      .output(timeEntryDTO)
      .mutation(async ({ ctx, input }) => {
        // Tech may only create entries for themselves.
        if (ctx.principal.role === "tech" && input.techUserId !== ctx.principal.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "techs may only create their own time entries" });
        }

        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateTimeEntryUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            techUserId: asUserId(input.techUserId),
            jobId: input.jobId ? asJobId(input.jobId) : null,
            workDate: input.workDate,
            kind: input.kind,
            startTime: input.startTime,
            endTime: input.endTime ?? null,
            note: input.note ?? "",
            src: input.src ?? "manual",
            running: input.running ?? false,
          },
          ctx.principal.orgId,
        );
        return toTimeEntryDTO(orThrow(result));
      }),

    update: anyRole
      .input(updateInput)
      .output(timeEntryDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        // Load first to authz-check ownership.
        const entry = await repo.findById(asTimeEntryId(input.entryId));
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "time entry not found" });
        }
        // Tech may only edit their own entries.
        if (ctx.principal.role === "tech" && entry.props.techUserId !== ctx.principal.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "techs may only edit their own time entries" });
        }

        const useCase = new UpdateTimeEntryUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            entryId: asTimeEntryId(input.entryId),
            jobId: input.jobId !== undefined ? (input.jobId ? asJobId(input.jobId) : null) : undefined,
            workDate: input.workDate,
            kind: input.kind,
            startTime: input.startTime,
            endTime: input.endTime,
            note: input.note,
            src: input.src,
            running: input.running,
          },
          ctx.principal.orgId,
        );
        return toTimeEntryDTO(orThrow(result));
      }),

    remove: anyRole
      .input(removeInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        // Load first to authz-check ownership.
        const entry = await repo.findById(asTimeEntryId(input.entryId));
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "time entry not found" });
        }
        // Tech may only remove their own entries.
        if (ctx.principal.role === "tech" && entry.props.techUserId !== ctx.principal.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "techs may only remove their own time entries" });
        }

        const useCase = new RemoveTimeEntryUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { entryId: asTimeEntryId(input.entryId) },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    // Reopen is a management action — ownerOrOffice only. Symmetric with approveWeek.
    reopen: ownerOrOffice
      .input(reopenInput)
      .output(timeEntryDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const entry = await repo.findById(asTimeEntryId(input.entryId));
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "time entry not found" });
        }
        const reopened = entry.reopen(ctx.deps.clock.now());
        await repo.save(reopened);
        logger.info(
          { entryId: input.entryId, orgId: ctx.principal.orgId },
          "time_entry.reopened",
        );
        return toTimeEntryDTO(reopened);
      }),

    // Approval is a management action — ownerOrOffice only.
    approveWeek: ownerOrOffice
      .input(approveWeekInput)
      .output(z.object({ approved: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ApproveWeekUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            techUserId: asUserId(input.techUserId),
            dates: input.dates,
          },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),
  });
