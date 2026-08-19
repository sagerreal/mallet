import type { Clock, LeadId, OrgId, Result, AppError } from "@mallet/shared/types";
import { ok, err, validation, notFound, isOk, asLeadId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { PipelineStage } from "../domain/pipeline-stage";
import type { PipelineStageRepository } from "../domain/pipeline-stage-repository";
import type { Lead } from "../domain/lead";

/**
 * modules/customers/app/pipeline-stages.ts
 * The shop-defined pipeline: create/rename/move/remove stages, seed from a template, and place a
 * lead. Stages are MANUAL by design — the shop's own process vocabulary, never derived, never
 * auto-advanced. The derived "where they are" facts render beside them and keep telling the truth.
 */

/** A board past this many columns is a spreadsheet wearing a board's clothes. */
export const PIPELINE_STAGE_MAX = 12;

/** Setup templates — starting points, not prescriptions; every stage stays editable after. */
export const PIPELINE_TEMPLATES = {
  sales: ["New lead", "Contacted", "Walkthrough booked", "Quote sent", "Follow-up", "Won"],
  insurance: ["New claim", "Adjuster meeting", "Claim approved", "Supplement filed", "Build scheduled", "Closed"],
  blank: ["Stage 1", "Stage 2", "Stage 3"],
} as const;
export type PipelineTemplate = keyof typeof PIPELINE_TEMPLATES;

export class CreatePipelineStageUseCase {
  constructor(
    private readonly repo: PipelineStageRepository,
    private readonly orgId: OrgId,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: { name: string }): Promise<Result<PipelineStage, AppError>> {
    const existing = await this.repo.list();
    if (existing.length >= PIPELINE_STAGE_MAX) {
      return err(validation(`a pipeline can have at most ${PIPELINE_STAGE_MAX} stages`, "name"));
    }
    const now = this.clock.now();
    const stage = PipelineStage.create({
      id: this.ids.newId(),
      orgId: this.orgId,
      name: cmd.name,
      // Append: a new stage lands after the shop's existing order, never in the middle of it.
      position: existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.props.position)) + 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (!isOk(stage)) return stage;
    await this.repo.save(stage.value);
    return stage;
  }
}

export class RenamePipelineStageUseCase {
  constructor(
    private readonly repo: PipelineStageRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: { id: string; name: string }): Promise<Result<PipelineStage, AppError>> {
    const stage = await this.repo.findById(cmd.id);
    if (!stage) return err(notFound("pipeline stage"));
    const renamed = stage.rename(cmd.name, this.clock.now());
    if (!isOk(renamed)) return renamed;
    await this.repo.save(renamed.value);
    return renamed;
  }
}

export class RemovePipelineStageUseCase {
  constructor(
    private readonly repo: PipelineStageRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Soft-delete. Leads pointing at the removed stage keep their FK (rows never hard-delete) and
   * simply render as unstaged — the read layer folds references to dead stages into "none".
   */
  async exec(cmd: { id: string }): Promise<Result<PipelineStage, AppError>> {
    const stage = await this.repo.findById(cmd.id);
    if (!stage) return err(notFound("pipeline stage"));
    const removed = stage.remove(this.clock.now());
    await this.repo.save(removed);
    return ok(removed);
  }
}

export class MovePipelineStageUseCase {
  constructor(
    private readonly repo: PipelineStageRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Swap with the neighbour. Up/down rather than drag-to-index: it is keyboard-operable, it needs
   * no position arithmetic on the client, and two swapped rows are one transaction's worth of
   * writes. Moving past the edge is a graceful no-op — reaching for "further up" from the top is
   * an ordinary tap, not an error.
   */
  async exec(cmd: { id: string; direction: "up" | "down" }): Promise<Result<PipelineStage[], AppError>> {
    const stages = await this.repo.list();
    const at = stages.findIndex((s) => s.props.id === cmd.id);
    if (at < 0) return err(notFound("pipeline stage"));
    const to = cmd.direction === "up" ? at - 1 : at + 1;
    if (to < 0 || to >= stages.length) return ok(stages);

    const now = this.clock.now();
    const a = stages[at]!.moveTo(stages[to]!.props.position, now);
    const b = stages[to]!.moveTo(stages[at]!.props.position, now);
    if (!isOk(a)) return a;
    if (!isOk(b)) return b;
    await this.repo.save(a.value);
    await this.repo.save(b.value);
    return ok(await this.repo.list());
  }
}

export class SeedPipelineStagesUseCase {
  constructor(
    private readonly repo: PipelineStageRepository,
    private readonly orgId: OrgId,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  /**
   * Create a template's stages — IDEMPOTENT. If any live stage exists the call returns them
   * untouched: a double-click or a retried request must not append a second pipeline onto the
   * first, and "seed" is only ever the first move on an empty board.
   */
  async exec(cmd: { template: PipelineTemplate }): Promise<Result<PipelineStage[], AppError>> {
    const existing = await this.repo.list();
    if (existing.length > 0) return ok(existing);

    const now = this.clock.now();
    const made: PipelineStage[] = [];
    for (const [i, name] of PIPELINE_TEMPLATES[cmd.template].entries()) {
      const stage = PipelineStage.create({
        id: this.ids.newId(),
        orgId: this.orgId,
        name,
        position: i,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      if (!isOk(stage)) return stage;
      await this.repo.save(stage.value);
      made.push(stage.value);
    }
    return ok(made);
  }
}

/** The two lead methods this use case needs — segregated so tests fake 2 methods, not 15. */
export interface LeadStageWriter {
  findById(id: LeadId): Promise<Lead | null>;
  save(lead: Lead): Promise<void>;
}

export class SetLeadPipelineStageUseCase {
  constructor(
    private readonly leads: LeadStageWriter,
    private readonly stages: PipelineStageRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Place a lead in a stage (null = unstage). The target must be a LIVE stage — findById does not
   * see soft-deleted ones — so a drop on a column removed in another tab fails with its real name
   * instead of writing a placement nothing will render. Cross-org linkage is impossible twice
   * over: the stage repo is org-bound, and leads_org_pipeline_stage_fk is the DB's own word.
   */
  async exec(cmd: { leadId: string; stageId: string | null }): Promise<Result<Lead, AppError>> {
    if (cmd.stageId !== null) {
      const stage = await this.stages.findById(cmd.stageId);
      if (!stage) return err(notFound("pipeline stage"));
    }
    const lead = await this.leads.findById(asLeadId(cmd.leadId));
    if (!lead) return err(notFound("customer"));
    const placed = lead.setPipelineStage(cmd.stageId, this.clock.now());
    if (placed !== lead) await this.leads.save(placed);
    return ok(placed);
  }
}
