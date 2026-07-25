import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { toPage, asJobId, asVisitId } from "@mallet/shared/types";
import { orThrow } from "@/trpc/errors";
import type { Principal } from "@mallet/identity";
import { logger } from "@mallet/shared/observability";
import { router, anyRole } from "@/trpc/init";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleLeadRepository } from "@mallet/customers";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { ListJobsUseCase } from "../app/list-jobs";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import { SetVisitStatusUseCase } from "../app/set-visit-status";
import { SetVisitEnrouteUseCase } from "../app/set-visit-enroute";
import { SetVerifyAnswerUseCase, AddJobPhotoUseCase, AddJobAddonUseCase } from "../app/job-execution-use-cases";
import type { Job } from "../domain/job";
import type { JobId, VisitId } from "@mallet/shared/types";
import { jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO, setVerifyAnswerInput, photoUploadUrlInput, addPhotoInput, photoUploadUrlDTO } from "./job-dto";
import { redactMoneyForTech } from "./money-redaction";
import { runVisitClockTap, CLOCK_TAP_FOR_STATUS, FIELD_VISIT_STATUSES, type ClockTapOutcome } from "./visit-clock-tap";

/**
 * Just enough of a customer for the field surface to name and reach them: who this job is for and
 * the number to call. Deliberately NOT the lead DTO — a technician has no business holding a
 * customer's value, stage, notes or owner, and this list is scoped to their own jobs anyway.
 */
const fieldCustomerDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
});

/** The distinct customers behind a page of jobs, in ONE read.
 *
 *  This was a loop of findById per job. myDay is the most-reloaded screen a technician has and the
 *  whole handler is deliberately sequential on one connection, so an N+1 here landed directly on
 *  the time between pressing a button and the screen changing. */
const loadCustomersFor = async (
  tx: TenantTx,
  orgId: OrgId,
  jobsOnPage: readonly Job[],
): Promise<z.infer<typeof fieldCustomerDTO>[]> => {
  const leadIds = [...new Set(jobsOnPage.map((j) => j.props.leadId))];
  const found = await new DrizzleLeadRepository(tx, orgId).findByIds(leadIds);
  return found.map((lead) => ({ id: lead.props.id, name: lead.props.name, phone: lead.props.phone }));
};

/**
 * What the tap quietly did, for the surface that made it. Null when there is nothing to say.
 *
 * "segment_too_short" is the one that cost a real afternoon: a job worked for under a minute is
 * discarded rather than rounded up, which is right, but nothing said so and the hours simply never
 * appeared. The field response carries it so the person who tapped finds out from the tap.
 */
const clockNoticeDTO = z.enum(["segment_too_short", "close_bounded"]);

const noticeFor = (outcome: ClockTapOutcome): z.infer<typeof clockNoticeDTO> | null =>
  outcome.discardedTooShort ? "segment_too_short" : outcome.boundedClose ? "close_bounded" : null;

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

/**
 * Visit-scoped authorisation. `assertOnJobIfTech` asks a JOB-level question — is this tech the job's
 * assignee, or the assignee of ANY of its visits — which is right for "may they open this job" and
 * wrong for "may they move this visit". On a two-visit job the job-level assignee would pass for a
 * colleague's visit and could mark it done, moving someone else's work and writing time against it.
 * Visit-scoped mutations must ask about the visit.
 */
const assertOnVisitIfTech = async (
  repo: DrizzleJobRepository,
  jobId: JobId,
  visitId: VisitId,
  principal: Principal,
): Promise<Job | null> => {
  if (principal.role !== "tech") return null;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!job.isAssignedToVisit(principal.userId, visitId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this visit isn't assigned to you" });
  }
  return job;
};

const jobIdInput = z.object({ jobId: z.string().uuid() });

const jobIdVisitIdInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
});

// The field surface's own status input. Narrower than the office's on purpose: the enum is the
// two step buttons a technician has (see FIELD_VISIT_STATUSES), so ↩ Reopen and cancel stay
// office-only at the API, not merely hidden in the UI.
const fieldSetVisitStatusInput = jobIdVisitIdInput.extend({
  status: z.enum(FIELD_VISIT_STATUSES),
});

// Every closed-job refusal on this surface says the same thing, and it names the next step rather
// than the rule that was broken.
const CLOSED_JOB_MESSAGE = "This job is closed — ask the office to change it.";

export const createFieldRouter = () =>
  router({
    myDay: anyRole.output(z.object({ items: z.array(jobSummaryDTO), customers: z.array(fieldCustomerDTO) })).query(async ({ ctx }) => {
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
      // The customers on THESE jobs, and no others — the technician's reach is their own work.
      // Without this the field shell has no name or number for anyone, which is why its Call
      // control could not work: the call bar renders the customer, and had nothing to render.
      const customers = await loadCustomersFor(ctx.tx, ctx.principal.orgId, ordered);
      return { items, customers };
    }),

    // start/complete return the full jobDTO — redact for techs like every other field
    // response (the client discards the body today, but money must never cross the wire
    // to a redacted tech's device).
    //
    // BOTH drive the clock, exactly as setVisitStatus does. These two are the big buttons on the My
    // day agenda card — the most-used job controls a technician has, reachable without opening the
    // modal at all. While they moved the job without moving the clock, a tech who worked entirely
    // from the agenda recorded ten hours of unattributed `shop` time and ZERO job time: payroll
    // right, job costing empty. The two entry points must not be able to diverge.
    start: anyRole.input(jobIdInput).output(jobDTO.extend({ clockNotice: clockNoticeDTO.nullable() })).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertOnJobIfTech(repo, jobId, ctx.principal);
      const started = orThrow(await new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId }));
      const dto = toJobDTO(started);
      // Starting the job = arriving on it: close the drive, open job time. Never fails the write.
      // Job-level, so job-level assignment is the right question — this button is not about one visit.
      const outcome = await runVisitClockTap(
        { tx: ctx.tx, principal: ctx.principal, clock: ctx.deps.clock, ids: ctx.deps.ids },
        "arrived",
        jobId,
        started.isAssignedTo(ctx.principal.userId),
      );
      const clockNotice = noticeFor(outcome);
      if (ctx.principal.role !== "tech") return { ...dto, clockNotice };
      const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
      return { ...redactMoneyForTech(dto, seesPrice), clockNotice };
    }),

    complete: anyRole.input(jobIdInput).output(jobDTO.extend({ clockNotice: clockNoticeDTO.nullable() })).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertOnJobIfTech(repo, jobId, ctx.principal);
      const completed = orThrow(await new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId }));
      const dto = toJobDTO(completed);
      // Completing the job = done on it: close job time and auto-resume shop, so whoever did the work
      // stays on the clock between calls. Never fails the write.
      const outcome = await runVisitClockTap(
        { tx: ctx.tx, principal: ctx.principal, clock: ctx.deps.clock, ids: ctx.deps.ids },
        "done",
        jobId,
        completed.isAssignedTo(ctx.principal.userId),
      );
      const clockNotice = noticeFor(outcome);
      if (ctx.principal.role !== "tech") return { ...dto, clockNotice };
      const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
      return { ...redactMoneyForTech(dto, seesPrice), clockNotice };
    }),

    // Arrived / ✓ Mark done from the technician's own visit row. Same use-case as the office
    // endpoint (v1.visits.setVisitStatus stays ownerOrOffice and is NOT loosened); this is a
    // sibling gated by assignment instead of by role, so a tech may only move a visit on a job
    // they are on. The tap also drives their clock — see runVisitClockTap.
    setVisitStatus: anyRole
      .input(fieldSetVisitStatusInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const visitId = asVisitId(input.visitId);
        const techJob = await assertOnVisitIfTech(repo, jobId, visitId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: CLOSED_JOB_MESSAGE });
        }
        const useCase = new SetVisitStatusUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        const job = orThrow(
          await useCase.exec({ jobId, visitId, status: input.status }),
        );

        // Hours are written AFTER the visit write, in the same transaction, and can never fail it.
        await runVisitClockTap(
          { tx: ctx.tx, principal: ctx.principal, clock: ctx.deps.clock, ids: ctx.deps.ids },
          CLOCK_TAP_FOR_STATUS[input.status],
          jobId,
          // VISIT-level: an owner-operator working their own visit gets the hours; an owner clearing
          // a colleague's visit is dispatching and gets none.
          job.isAssignedToVisit(ctx.principal.userId, visitId),
        );

        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId, status: input.status },
          "job_visit.status_set",
        );
        const dto = toJobDTO(job);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice);
      }),

    // "On my way" from the technician's own visit row. A STAMP, not a status change — the visit
    // stays pending — which is why it needs its own procedure rather than a status value (routed
    // through setVisitStatus it would arrive as the status the visit already has and be
    // short-circuited as idempotent). Assignment-gated; drives the travel segment on the clock.
    setVisitEnroute: anyRole
      .input(jobIdVisitIdInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const visitId = asVisitId(input.visitId);
        const techJob = await assertOnVisitIfTech(repo, jobId, visitId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: CLOSED_JOB_MESSAGE });
        }
        const useCase = new SetVisitEnrouteUseCase(repo, ctx.deps.clock);
        const job = orThrow(await useCase.exec({ jobId, visitId }));

        // Run on EVERY tap, including a repeat one the use-case treats as idempotent: the clock
        // decides for itself whether a segment is already open (planTap no-ops a double tap), and
        // a second tap is then the only thing that can repair a segment an earlier failure lost.
        await runVisitClockTap(
          { tx: ctx.tx, principal: ctx.principal, clock: ctx.deps.clock, ids: ctx.deps.ids },
          "enroute",
          jobId,
          job.isAssignedToVisit(ctx.principal.userId, visitId),
        );

        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.enroute_set",
        );
        const dto = toJobDTO(job);
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
