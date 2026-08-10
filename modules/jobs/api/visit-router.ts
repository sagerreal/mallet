import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asJobId, asVisitId, asUserId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { DrizzleCostRateReader } from "../infra/drizzle-cost-rate-reader";
import { CreateVisitUseCase } from "../app/create-visit";
import { ScheduleVisitUseCase } from "../app/schedule-visit";
import { UpdateVisitDurationUseCase } from "../app/update-visit-duration";
import { PatchVisitScheduleUseCase } from "../app/patch-visit-schedule";
import { RemoveVisitUseCase } from "../app/remove-visit";
import { SetVisitStatusUseCase } from "../app/set-visit-status";
import { SetVisitEnrouteUseCase } from "../app/set-visit-enroute";
import { visitStatusEnum, jobDTO, toJobDTOWithExecution } from "./job-dto";

// Shared input fragments.
const jobIdVisitId = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
});

const createVisitInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid().optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  scheduledStart: z.string().nullable().optional(),
  durationHours: z.number().positive().max(24),
  notes: z.string().max(2000).nullable().optional(),
});

const scheduleVisitInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
  assigneeUserId: z.string().uuid(),
  scheduledDate: z.string(),
  scheduledStart: z.string(),
  durationHours: z.number().positive().max(24),
});

const updateVisitDurationInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
  durationHours: z.number().positive().max(24),
});

const patchVisitScheduleInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  scheduledDate: z.string().nullable().optional(),
  scheduledStart: z.string().nullable().optional(),
  scheduledEnd: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const setVisitStatusInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
  status: visitStatusEnum,
});

// Layer 5: thin transport. Build org-scoped use-cases from the request's tx + ports, delegate,
// return the full refreshed jobDTO so the client re-syncs the whole job including all visits.
//
// "Full" means WITH the job's execution (toJobDTOWithExecution, not toJobDTO). These responses are
// what the store replaces its job with, and a bare toJobDTO ships `lines: []` — so moving a visit
// used to erase the job's price client-side until the next list refetch put it back. See the
// helper's docstring.
export const createVisitRouter = () =>
  router({
    createVisit: ownerOrOffice
      .input(createVisitInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateVisitUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: input.visitId,
            assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : null,
            scheduledDate: input.scheduledDate ?? null,
            scheduledStart: input.scheduledStart ?? null,
            durationHours: input.durationHours,
            notes: input.notes ?? null,
          }),
        );
        logger.info(
          { jobId: input.jobId, orgId: ctx.principal.orgId },
          "job_visit.created",
        );
        return toJobDTOWithExecution(repo, job);
      }),

    scheduleVisit: ownerOrOffice
      .input(scheduleVisitInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ScheduleVisitUseCase(repo, ctx.deps.clock);
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: asVisitId(input.visitId),
            assigneeUserId: asUserId(input.assigneeUserId),
            scheduledDate: input.scheduledDate,
            scheduledStart: input.scheduledStart,
            durationHours: input.durationHours,
          }),
        );
        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.scheduled",
        );
        return toJobDTOWithExecution(repo, job);
      }),

    updateVisitDuration: ownerOrOffice
      .input(updateVisitDurationInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateVisitDurationUseCase(repo, ctx.deps.clock);
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: asVisitId(input.visitId),
            durationHours: input.durationHours,
          }),
        );
        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.duration_updated",
        );
        return toJobDTOWithExecution(repo, job);
      }),

    patchVisitSchedule: ownerOrOffice
      .input(patchVisitScheduleInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new PatchVisitScheduleUseCase(repo, ctx.deps.clock);
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: asVisitId(input.visitId),
            assigneeUserId:
              input.assigneeUserId !== undefined
                ? input.assigneeUserId !== null
                  ? asUserId(input.assigneeUserId)
                  : null
                : undefined,
            scheduledDate: input.scheduledDate,
            scheduledStart: input.scheduledStart,
            scheduledEnd: input.scheduledEnd,
            notes: input.notes,
          }),
        );
        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.schedule_patched",
        );
        return toJobDTOWithExecution(repo, job);
      }),

    removeVisit: ownerOrOffice
      .input(jobIdVisitId)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveVisitUseCase(repo, ctx.deps.clock);
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: asVisitId(input.visitId),
          }),
        );
        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.removed",
        );
        return toJobDTOWithExecution(repo, job);
      }),

    setVisitStatus: ownerOrOffice
      .input(setVisitStatusInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetVisitStatusUseCase(repo, ctx.deps.bus, ctx.deps.clock, new DrizzleCostRateReader(ctx.tx, ctx.principal.orgId));
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: asVisitId(input.visitId),
            status: input.status,
          }),
        );
        logger.info(
          {
            jobId: input.jobId,
            visitId: input.visitId,
            orgId: ctx.principal.orgId,
            status: input.status,
          },
          "job_visit.status_set",
        );
        return toJobDTOWithExecution(repo, job);
      }),

    // "On my way". Separate from setVisitStatus because it is NOT a status change: the visit
    // stays pending and only enroute_at moves. Routed through setVisitStatus it would arrive as
    // the status the visit already has and be short-circuited as idempotent, which is exactly
    // how this tap became a server no-op in the first place.
    setVisitEnroute: ownerOrOffice
      .input(jobIdVisitId)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetVisitEnrouteUseCase(repo, ctx.deps.clock);
        const job = orThrow(
          await useCase.exec({
            jobId: asJobId(input.jobId),
            visitId: asVisitId(input.visitId),
          }),
        );
        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.enroute_set",
        );
        return toJobDTOWithExecution(repo, job);
      }),
  });
