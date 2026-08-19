import { z } from "zod";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { DrizzlePipelineStageRepository } from "../infra/drizzle-pipeline-stage-repository";
import { DrizzleLeadRepository } from "../infra/drizzle-lead-repository";
import { STAGE_NAME_MAX, type PipelineStage } from "../domain/pipeline-stage";
import {
  CreatePipelineStageUseCase,
  RenamePipelineStageUseCase,
  RemovePipelineStageUseCase,
  MovePipelineStageUseCase,
  SeedPipelineStagesUseCase,
  SetLeadPipelineStageUseCase,
  PIPELINE_TEMPLATES,
  type PipelineTemplate,
} from "../app/pipeline-stages";

/**
 * modules/customers/api/pipeline-router.ts
 * The shop-defined pipeline: stages CRUD, template seeding, and lead placement. Mounted inside
 * the customers router (v1.customers.pipeline.*) because a stage is a property of the customer
 * book, not its own domain.
 *
 * Board CARDS are deliberately not served here — they are v1.customers.list with the
 * `pipelineStage` filter, so columns get the same DTO, pagination and search the list already has
 * instead of a second, slightly different way to read customers.
 */

const stageDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  position: z.number().int(),
});

const toStageDTO = (s: PipelineStage) => ({
  id: s.props.id,
  name: s.props.name,
  position: s.props.position,
});

const TEMPLATE_IDS = Object.keys(PIPELINE_TEMPLATES) as [PipelineTemplate, ...PipelineTemplate[]];

/**
 * The board head in ONE read: live stages in order, each with its live-lead count, plus the
 * unstaged count. Counts for soft-deleted stages fold into `unstaged` here — only this layer
 * knows which stage ids are live — so removing a column visibly returns its customers to the
 * leading column instead of vanishing them.
 */
const boardDTO = z.object({
  stages: z.array(stageDTO.extend({ count: z.number().int() })),
  unstaged: z.number().int(),
});

export const createPipelineRouter = () =>
  router({
    board: ownerOrOffice.output(boardDTO).query(async ({ ctx }) => {
      const stageRepo = new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId);
      const [stages, counts] = await Promise.all([
        stageRepo.list(),
        new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).pipelineStageCounts(),
      ]);
      const live = new Set(stages.map((s) => s.props.id));
      let unstaged = 0;
      for (const [key, n] of Object.entries(counts)) {
        if (!live.has(key)) unstaged += n; // "none" and any dead stage's stragglers
      }
      return {
        stages: stages.map((s) => ({ ...toStageDTO(s), count: counts[s.props.id] ?? 0 })),
        unstaged,
      };
    }),

    seed: ownerOrOffice
      .input(z.object({ template: z.enum(TEMPLATE_IDS) }))
      .output(z.array(stageDTO))
      .mutation(async ({ ctx, input }) => {
        const uc = new SeedPipelineStagesUseCase(
          new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId),
          ctx.principal.orgId,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return orThrow(await uc.exec({ template: input.template })).map(toStageDTO);
      }),

    createStage: ownerOrOffice
      .input(z.object({ name: z.string().trim().min(1).max(STAGE_NAME_MAX) }))
      .output(stageDTO)
      .mutation(async ({ ctx, input }) => {
        const uc = new CreatePipelineStageUseCase(
          new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId),
          ctx.principal.orgId,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toStageDTO(orThrow(await uc.exec({ name: input.name })));
      }),

    renameStage: ownerOrOffice
      .input(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(STAGE_NAME_MAX) }))
      .output(stageDTO)
      .mutation(async ({ ctx, input }) => {
        const uc = new RenamePipelineStageUseCase(
          new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
        );
        return toStageDTO(orThrow(await uc.exec(input)));
      }),

    removeStage: ownerOrOffice
      .input(z.object({ id: z.string().uuid() }))
      .output(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const uc = new RemovePipelineStageUseCase(
          new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
        );
        return { id: orThrow(await uc.exec(input)).props.id };
      }),

    moveStage: ownerOrOffice
      .input(z.object({ id: z.string().uuid(), direction: z.enum(["up", "down"]) }))
      .output(z.array(stageDTO))
      .mutation(async ({ ctx, input }) => {
        const uc = new MovePipelineStageUseCase(
          new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
        );
        return orThrow(await uc.exec(input)).map(toStageDTO);
      }),

    setLeadStage: ownerOrOffice
      .input(z.object({ leadId: z.string().uuid(), stageId: z.string().uuid().nullable() }))
      .output(z.object({ leadId: z.string().uuid(), pipelineStageId: z.string().uuid().nullable() }))
      .mutation(async ({ ctx, input }) => {
        const uc = new SetLeadPipelineStageUseCase(
          new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId),
          new DrizzlePipelineStageRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
        );
        const lead = orThrow(await uc.exec(input));
        return { leadId: lead.props.id, pipelineStageId: lead.props.pipelineStageId };
      }),
  });
