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
import { CreateManualJobUseCase } from "../app/create-manual-job";
import { UpdateJobUseCase } from "../app/update-job";
import {
  JOB_CHECKLIST_MAX_ITEMS,
  JOB_CHECKLIST_NAME_MAX,
  JOB_CHECKLIST_ITEM_TEXT_MAX,
} from "../domain/job";
import { ArchiveJobUseCase } from "../app/archive-job";
import { statusEnum, jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO, setVerifyAnswerInput } from "./job-dto";
import {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "../app/job-execution-use-cases";

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

// Named input schemas for the manual-job mutation surface (exported so the store can
// reuse them for client-side validation without duplicating the bounds).
export const createJobInput = z.object({
  id: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  title: z.string().max(200).optional(),
  svc: z.string().min(1).max(60).optional(),
  addr: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  notes: z.string().max(10_000).optional(),
});
// Before-you-leave checklist payload — bounds come from the domain constants
// (name ≤ 200, item text ≤ 500, ≤ 50 items — matched to the checklist TEMPLATE
// bounds so any valid template attaches). Exported for store-side reuse.
export const jobChecklistInput = z.object({
  name: z.string().min(1).max(JOB_CHECKLIST_NAME_MAX),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        text: z.string().min(1).max(JOB_CHECKLIST_ITEM_TEXT_MAX),
        type: z.enum(["check", "photo"]),
        required: z.boolean().default(false),
      }),
    )
    .max(JOB_CHECKLIST_MAX_ITEMS),
});
export const updateJobInput = z.object({
  jobId: z.string().uuid(),
  title: z.string().max(200).nullable().optional(),
  svc: z.string().min(1).max(60).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  // undefined = keep; null = detach; object = attach/replace.
  checklist: jobChecklistInput.nullable().optional(),
});
export const archiveJobInput = z.object({ jobId: z.string().uuid() });

// ── Execution input schemas ───────────────────────────────────────────────────

const lineFields = {
  description: z.string().min(1).max(2000),
  quantity: z.number().min(0),
  rateCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
};
const addLineInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), ...lineFields, position: z.number().int().min(0).optional() });
const updateLineInput = z.object({ jobId: z.string().uuid(), lineId: z.string().uuid(), ...lineFields, position: z.number().int().min(0) });
const removeLineInput = z.object({ jobId: z.string().uuid(), lineId: z.string().uuid() });
const addAddonInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), description: z.string().min(1).max(2000), quantity: z.number().min(0).default(1), rateCents: z.number().int().min(0), costCents: z.number().int().min(0).default(0), isOptional: z.boolean().optional() });
const setAddonStatusInput = z.object({ jobId: z.string().uuid(), addonId: z.string().uuid(), status: z.enum(["proposed", "approved", "declined"]) });
const setAddonInvSkipInput = z.object({ jobId: z.string().uuid(), addonId: z.string().uuid(), invoiceSkip: z.boolean() });
// setVerifyAnswerInput moved to job-dto.ts — shared with the tech field-router.
const photoUploadUrlInput = z.object({ jobId: z.string().uuid(), objectId: z.string().uuid(), ext: z.string().min(1).max(10) });
const addPhotoInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), storagePath: z.string().min(1).max(1024), caption: z.string().max(2000).nullable().optional(), verifyPass: z.boolean().optional() });
const removePhotoInput = z.object({ jobId: z.string().uuid(), photoId: z.string().uuid() });

const photoUploadUrlDTO = z.object({ signedUrl: z.string(), token: z.string(), storagePath: z.string() });

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

    // Create a manual (unscheduled) job for a lead. addr/phone accepted for modal parity
    // but are not job columns — the use-case intentionally drops them.
    create: ownerOrOffice
      .input(createJobInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateManualJobUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toJobDTO(
          orThrow(
            await useCase.exec({
              id: input.id,
              orgId: ctx.principal.orgId,
              leadId: asLeadId(input.leadId),
              title: input.title ?? null,
              svc: input.svc ?? null,
              addr: input.addr ?? null,
              phone: input.phone ?? null,
              notes: input.notes ?? null,
            }),
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
        return { items: page.items.map((j) => toJobSummaryDTO(j)), nextCursor: page.nextCursor };
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
        return { items: page.items.map((j) => toJobSummaryDTO(j)), nextCursor: page.nextCursor };
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

    // ── Job execution procedures ──────────────────────────────────────────────

    addLine: ownerOrOffice
      .input(addLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobLineUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, position: input.position },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    updateLine: ownerOrOffice
      .input(updateLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateJobLineUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), lineId: input.lineId, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, position: input.position },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    removeLine: ownerOrOffice
      .input(removeLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveJobLineUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), lineId: input.lineId }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    addAddon: ownerOrOffice
      .input(addAddonInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobAddonUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, isOptional: input.isOptional },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    setAddonStatus: ownerOrOffice
      .input(setAddonStatusInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetAddonStatusUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), addonId: input.addonId, status: input.status }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    setAddonInvSkip: ownerOrOffice
      .input(setAddonInvSkipInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetAddonInvoiceSkipUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), addonId: input.addonId, invoiceSkip: input.invoiceSkip }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    setVerifyAnswer: ownerOrOffice
      .input(setVerifyAnswerInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetVerifyAnswerUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), itemId: input.itemId, state: input.state, via: input.via ?? null, reason: input.reason ?? null },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    photoUploadUrl: ownerOrOffice
      .input(photoUploadUrlInput)
      .output(photoUploadUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "photo storage is not configured" });
        }
        // Confirm the job exists in this org before minting an upload URL (fail-closed).
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const job = await repo.findById(asJobId(input.jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        const result = await ctx.deps.photoStorageGateway.createUploadUrl({
          orgId: ctx.principal.orgId,
          jobId: asJobId(input.jobId),
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!result.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "could not create upload url" });
        return result.value;
      }),

    addPhoto: ownerOrOffice
      .input(addPhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobPhotoUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, storagePath: input.storagePath, caption: input.caption ?? null, verifyPass: input.verifyPass ?? false },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    removePhoto: ownerOrOffice
      .input(removePhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveJobPhotoUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), photoId: input.photoId }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    // Patch title/svc/notes/checklist on a non-terminal job. undefined fields are kept
    // as-is; explicit null clears an optional field. org isolation enforced by RLS via ctx.tx.
    update: ownerOrOffice
      .input(updateJobInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTO(
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              title: input.title,
              svc: input.svc,
              notes: input.notes,
              checklist: input.checklist,
            }),
          ),
        );
      }),

    // Soft-delete a job. Returns NOT_FOUND when the job is unknown or already archived.
    archive: ownerOrOffice
      .input(archiveJobInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveJobUseCase(repo, ctx.deps.clock);
        return orThrow(await useCase.exec({ jobId: asJobId(input.jobId) }));
      }),
  });
