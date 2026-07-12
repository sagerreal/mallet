import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { toPage, asJobId } from "@mallet/shared/types";
import { orThrow } from "@/trpc/errors";
import type { Principal } from "@mallet/identity";
import { router, anyRole } from "@/trpc/init";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { ListJobsUseCase } from "../app/list-jobs";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import { SetVerifyAnswerUseCase } from "../app/job-execution-use-cases";
import type { JobId } from "@mallet/shared/types";
import { jobDTO, jobSummaryDTO, toJobDTO, toJobSummaryDTO, setVerifyAnswerInput } from "./job-dto";

// The tech-facing surface. Assignment is the authorization boundary for techs: a tech may act only
// on jobs assigned to them (owner/office pass — they already hold the office surface). This check
// lives at the API layer, where the codebase makes its role-based FORBIDDEN decisions.
const assertMineIfTech = async (repo: DrizzleJobRepository, jobId: JobId, principal: Principal): Promise<void> => {
  if (principal.role !== "tech") return;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (job.props.assigneeUserId !== principal.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
};

// Wider assignment check for job-site capture (verify answers): a tech is "on" a job when they
// are the job-level assignee OR assigned to any active visit (Job.isAssignedTo — the domain owns
// the rule). start/complete keep the narrower job-assignee-only check above on purpose: widening
// them is a behavior change to the dispatch flow that needs its own decision (see the
// visit-assignment gap note in the branch report) — don't fold the two helpers together.
const assertOnJobIfTech = async (repo: DrizzleJobRepository, jobId: JobId, principal: Principal): Promise<void> => {
  if (principal.role !== "tech") return;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!job.isAssignedTo(principal.userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
};

const jobIdInput = z.object({ jobId: z.string().uuid() });

export const createFieldRouter = () =>
  router({
    myDay: anyRole.output(z.object({ items: z.array(jobSummaryDTO) })).query(async ({ ctx }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const useCase = new ListJobsUseCase(repo);
      const mine = { assigneeUserId: ctx.principal.userId };
      // Sequential on purpose: one tx = one connection.
      const inProgress = await useCase.exec({ page: toPage({ limit: 50, cursor: null }), filter: { ...mine, status: "in_progress" } });
      const scheduled = await useCase.exec({ page: toPage({ limit: 50, cursor: null }), filter: { ...mine, status: "scheduled" } });
      const byStart = (a: (typeof inProgress.items)[number], b: (typeof inProgress.items)[number]) => {
        const av = a.props.scheduledStart ? a.props.scheduledStart.getTime() : Infinity;
        const bv = b.props.scheduledStart ? b.props.scheduledStart.getTime() : Infinity;
        return av - bv;
      };
      const ordered = [...[...inProgress.items].sort(byStart), ...[...scheduled.items].sort(byStart)];
      // Load execution data (checklist answers, add-ons, photos) per job so the tech's
      // device sees saved check-offs — toJobSummaryDTO without it returns empty arrays.
      // Sequential per job for the same one-tx-one-connection reason; a tech's day is
      // small (the 50/50 page caps above are a ceiling, not a typical load).
      const items: ReturnType<typeof toJobSummaryDTO>[] = [];
      for (const j of ordered) {
        const execution = await repo.listExecution(j.props.id);
        items.push(toJobSummaryDTO(j, execution));
      }
      return { items };
    }),

    start: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertMineIfTech(repo, jobId, ctx.principal);
      return toJobDTO(orThrow(await new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId })));
    }),

    complete: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertMineIfTech(repo, jobId, ctx.principal);
      return toJobDTO(orThrow(await new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId })));
    }),

    // Crew checklist capture: write one verify answer (pass/override/clear) from the job site.
    // Same input contract and full-jobDTO return as the office v1.jobs.setVerifyAnswer; the tech
    // path adds the assignment gate, then delegates to the SAME use-case (no duplicated logic).
    setVerifyAnswer: anyRole
      .input(setVerifyAnswerInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        await assertOnJobIfTech(repo, jobId, ctx.principal);
        const useCase = new SetVerifyAnswerUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId, itemId: input.itemId, state: input.state, via: input.via ?? null, reason: input.reason ?? null },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),
  });
