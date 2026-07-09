import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asJobId, asLeadId, asEstimateId, asUserId, toPage } from "@mallet/shared/types";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { DrizzleEstimateReader } from "../infra/drizzle-estimate-reader";
import { ScheduleJobUseCase } from "../app/schedule-job";
import { CreateJobFromEstimateUseCase } from "../app/create-job-from-estimate";
import { RescheduleJobUseCase } from "../app/reschedule-job";
import { AssignJobUseCase } from "../app/assign-job";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import { CancelJobUseCase } from "../app/cancel-job";
import { ListJobsUseCase } from "../app/list-jobs";
import { statusEnum, jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO } from "./job-dto";

const paginatedSummaryDTO = z.object({
  items: z.array(jobSummaryDTO),
  nextCursor: z.string().nullable(),
});

const scheduleDirectInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  assigneeUserId: z.string().uuid().optional(),
});
const rescheduleInput = z.object({
  jobId: z.string().uuid(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
});
const assignInput = z.object({
  jobId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
});
const jobIdInput = z.object({ jobId: z.string().uuid() });
const cancelInput = z.object({ jobId: z.string().uuid(), reason: z.string().min(1) });
const fromEstimateInput = z.object({ estimateId: z.string().uuid() });
const listInput = z.object({
  // 500 matches the leads endpoint cap and the frontend hydrator's pilot ceiling.
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  status: statusEnum.optional(),
  assigneeUserId: z.string().uuid().optional(),
});
const listByLeadInput = z.object({
  leadId: z.string().uuid(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().nullish(),
});

// Layer 5: thin transport. Build org-scoped use-cases from the request's tx + ports, delegate,
// map the result. No business logic here.
export const createJobRouter = () =>
  router({
    scheduleDirect: ownerOrOffice
      .input(scheduleDirectInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ScheduleJobUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          leadId: asLeadId(input.leadId),
          title: input.title ?? null,
          scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
          scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
          assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : null,
        });
        return toJobDTO(orThrow(result));
      }),

    createFromEstimate: ownerOrOffice
      .input(fromEstimateInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const reader = new DrizzleEstimateReader(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateJobFromEstimateUseCase(
          repo,
          reader,
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toJobDTO(
          orThrow(
            await useCase.exec({ orgId: ctx.principal.orgId, estimateId: asEstimateId(input.estimateId) }),
          ),
        );
      }),

    get: ownerOrOffice
      .input(jobIdInput)
      .output(jobDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const job = await repo.findById(asJobId(input.jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        return toJobDTO(job);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const page = await new ListJobsUseCase(repo).exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: {
            status: input.status,
            assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : undefined,
          },
        });
        return { items: page.items.map(toJobSummaryDTO), nextCursor: page.nextCursor };
      }),

    listByLead: ownerOrOffice
      .input(listByLeadInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.listByLead(
          asLeadId(input.leadId),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        return { items: page.items.map(toJobSummaryDTO), nextCursor: page.nextCursor };
      }),

    schedule: ownerOrOffice
      .input(rescheduleInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RescheduleJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              scheduledStart: new Date(input.scheduledStart),
              scheduledEnd: new Date(input.scheduledEnd),
            }),
          ),
        );
      }),

    assign: ownerOrOffice
      .input(assignInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AssignJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : null,
            }),
          ),
        );
      }),

    start: ownerOrOffice
      .input(jobIdInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(orThrow(await useCase.exec({ jobId: asJobId(input.jobId) })));
      }),

    complete: ownerOrOffice
      .input(jobIdInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(orThrow(await useCase.exec({ jobId: asJobId(input.jobId) })));
      }),

    cancel: ownerOrOffice
      .input(cancelInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CancelJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(
          orThrow(await useCase.exec({ jobId: asJobId(input.jobId), reason: input.reason })),
        );
      }),
  });
