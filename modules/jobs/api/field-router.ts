import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { toPage, asJobId } from "@mallet/shared/types";
import { orThrow } from "@/trpc/errors";
import type { Principal } from "@mallet/identity";
import { router, anyRole } from "@/trpc/init";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { ListJobsUseCase } from "../app/list-jobs";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import { SetVerifyAnswerUseCase, AddJobPhotoUseCase, AddJobAddonUseCase } from "../app/job-execution-use-cases";
import type { Job } from "../domain/job";
import type { JobId } from "@mallet/shared/types";
import { jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO, setVerifyAnswerInput, photoUploadUrlInput, addPhotoInput, photoUploadUrlDTO } from "./job-dto";
import { redactMoneyForTech } from "./money-redaction";

// Field-surface add-addon input: description 1..200, optional client-authored id for idempotent
// retry (mirrors the office addAddonInput's optional id), optional rate (tech with !seesPrice has
// it zeroed server-side; seesPrice techs and office callers may send a real rate).
const fieldAddAddonInput = z.object({
  jobId: z.string().uuid(),
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1, "description is required").max(200, "description must be 200 characters or fewer"),
  rateCents: z.number().int().min(0).optional(),
});

// The tech-facing surface. Assignment is the authorization boundary for techs: a tech may act only
// on jobs they are ON — the job-level assignee OR the assignee of any active visit
// (Job.isAssignedTo — the domain owns the rule; the schedule board dispatches crew per visit).
// Owner/office pass (they already hold the office surface). Returns the loaded job for tech
// callers so follow-up gates (job status) don't re-load it; null for owner/office.
const assertOnJobIfTech = async (
  repo: DrizzleJobRepository,
  jobId: JobId,
  principal: Principal,
): Promise<Job | null> => {
  if (principal.role !== "tech") return null;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!job.isAssignedTo(principal.userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
  return job;
};

const jobIdInput = z.object({ jobId: z.string().uuid() });

export const createFieldRouter = () =>
  router({
    myDay: anyRole.output(z.object({ items: z.array(jobSummaryDTO) })).query(async ({ ctx }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const useCase = new ListJobsUseCase(repo);
      // Visit-aware assignment (same predicate the write gates use): a tech sees every
      // job they can act on, including jobs where they only hold a visit.
      const mine = { assignedUserId: ctx.principal.userId };
      // Sequential on purpose: one tx = one connection.
      const inProgress = await useCase.exec({ page: toPage({ limit: 50, cursor: null }), filter: { ...mine, status: "in_progress" } });
      const scheduled = await useCase.exec({ page: toPage({ limit: 50, cursor: null }), filter: { ...mine, status: "scheduled" } });
      const byStart = (a: (typeof inProgress.items)[number], b: (typeof inProgress.items)[number]) => {
        const av = a.props.scheduledStart ? a.props.scheduledStart.getTime() : Infinity;
        const bv = b.props.scheduledStart ? b.props.scheduledStart.getTime() : Infinity;
        return av - bv;
      };
      const ordered = [...[...inProgress.items].sort(byStart), ...[...scheduled.items].sort(byStart)];
      // Load execution data (checklist answers, add-ons, photos) for the whole page in one
      // batched read (4 IN-clause queries) — toJobSummaryDTO without it returns empty arrays.
      const executionByJob = await repo.listExecutionForJobs(ordered.map((j) => j.props.id));
      const isTech = ctx.principal.role === "tech";
      const seesPrice = isTech
        ? await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice()
        : true;
      const items = ordered.map((j) => {
        const dto = toJobSummaryDTO(j, executionByJob.get(j.props.id));
        return isTech ? redactMoneyForTech(dto, seesPrice) : dto;
      });
      return { items };
    }),

    // start/complete return the full jobDTO — redact for techs like every other field
    // response (the client discards the body today, but money must never cross the wire
    // to a redacted tech's device).
    start: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertOnJobIfTech(repo, jobId, ctx.principal);
      const dto = toJobDTO(orThrow(await new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId })));
      if (ctx.principal.role !== "tech") return dto;
      const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
      return redactMoneyForTech(dto, seesPrice);
    }),

    complete: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertOnJobIfTech(repo, jobId, ctx.principal);
      const dto = toJobDTO(orThrow(await new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId })));
      if (ctx.principal.role !== "tech") return dto;
      const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
      return redactMoneyForTech(dto, seesPrice);
    }),

    // Mint a signed upload URL for a job photo from the field surface. Any role may call this
    // (techs are assignment-gated via assertOnJobIfTech). A non-terminal gate prevents minting
    // upload URLs against already-closed jobs. The gateway must be configured or the endpoint
    // returns PRECONDITION_FAILED (self-disable pattern — same as the office surface).
    photoUploadUrl: anyRole
      .input(photoUploadUrlInput)
      .output(photoUploadUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "photo storage is not configured" });
        }
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
        }
        // Confirm the job exists for non-tech callers (assertOnJobIfTech already loads it for techs).
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
          }
        }
        const result = await ctx.deps.photoStorageGateway.createUploadUrl({
          orgId: ctx.principal.orgId,
          jobId,
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!result.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "could not create upload url" });
        return result.value;
      }),

    // Attach a photo row to a job from the field surface. Delegates to the SAME AddJobPhotoUseCase
    // as the office surface — the use-case's prefix guard catches any forged storagePath. Response
    // is redacted for techs (same B1 pattern as setVerifyAnswer).
    addPhoto: anyRole
      .input(addPhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
        }
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
          }
        }
        const useCase = new AddJobPhotoUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId, id: input.id, storagePath: input.storagePath, caption: input.caption ?? null, verifyPass: input.verifyPass ?? false },
            ctx.principal.orgId,
          ),
        );
        const dto = toJobDTO(r.job, r.execution);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice);
      }),

    // Field-surface found-work write. Open to all roles (anyRole) but techs are assignment-gated
    // and non-terminal-gated like every other field write. The money contract is strict:
    //   • status is ALWAYS "proposed" — the office OK-pill is the approval gate; a tech may never
    //     land an accepted addon.
    //   • For tech callers with !techSeesPrice: IGNORE the client's rateCents entirely → store 0.
    //     seesPrice techs may pass a rate; owner/office callers behave like the office endpoint.
    //   • org from principal (never from client input).
    //   • response is redacted for techs (B1 pattern — same as setVerifyAnswer / addPhoto).
    //   • quantity and costCents are forced to the office defaults (1, 0) — techs don't author
    //     cost; office callers should use the office addAddon endpoint for full control.
    //   • isOptional follows the office default (false) for field-created found work.
    addAddon: anyRole
      .input(fieldAddAddonInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
          }
        }

        const isTech = ctx.principal.role === "tech";
        let rateCents: number;
        if (isTech) {
          const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
          // Money contract: !seesPrice → force 0 regardless of what the client sent.
          rateCents = seesPrice ? (input.rateCents ?? 0) : 0;
        } else {
          rateCents = input.rateCents ?? 0;
        }

        const useCase = new AddJobAddonUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            {
              jobId,
              id: input.id,
              description: input.description.trim(),
              quantity: 1,
              rateCents,
              costCents: 0, // NEVER client-settable from the field; owner/office wanting cost authoring use v1.jobs.addAddon
              isOptional: false,
            },
            ctx.principal.orgId,
          ),
        );
        const dto = toJobDTO(r.job, r.execution);
        if (!isTech) return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice);
      }),

    // Crew checklist capture: write one verify answer (pass/override/clear) from the job site.
    // Same input contract and full-jobDTO return as the office v1.jobs.setVerifyAnswer; the tech
    // path adds the assignment gate + a terminal-status gate (the before-you-leave checklist is
    // completion evidence — once the job is closed only the office may correct it), then
    // delegates to the SAME use-case (no duplicated logic).
    setVerifyAnswer: anyRole
      .input(setVerifyAnswerInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }
        const useCase = new SetVerifyAnswerUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId, itemId: input.itemId, state: input.state, via: input.via ?? null, reason: input.reason ?? null },
            ctx.principal.orgId,
          ),
        );
        const dto = toJobDTO(r.job, r.execution);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice);
      }),
  });
