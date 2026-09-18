import type { OrgId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

/**
 * A shop-defined pipeline stage — one column on the customers Pipeline board.
 *
 * MANUAL BY DESIGN. Stages are the shop's own process vocabulary ("Adjuster meeting",
 * "Follow-up 2"); Mallet does not move customers between them and does not pretend to know what
 * they mean. That is the deliberate opposite of the derived "where they are" views
 * (infra/lead-views.ts), which are computed from facts and cannot lie. The board shows both:
 * the shop's column, and the derived fact on every card.
 */

/** A column head is a label, not a paragraph. */
export const STAGE_NAME_MAX = 40;

export interface PipelineStageProps {
  readonly id: string;
  readonly orgId: OrgId;
  readonly name: string;
  /** 0-based board order, unique per org in practice (enforced by the reorder use case). */
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const validName = (raw: string): Result<string, ValidationError> => {
  const name = raw.trim();
  if (name.length === 0) return err(validation("a stage needs a name", "name"));
  if (name.length > STAGE_NAME_MAX) {
    return err(validation(`a stage name cannot exceed ${STAGE_NAME_MAX} characters`, "name"));
  }
  return ok(name);
};

export class PipelineStage {
  private constructor(private readonly p: PipelineStageProps) {}

  static create(props: PipelineStageProps): Result<PipelineStage, ValidationError> {
    const name = validName(props.name);
    if (!name.ok) return name;
    if (!Number.isInteger(props.position) || props.position < 0) {
      return err(validation("a stage position must be a non-negative whole number", "position"));
    }
    return ok(new PipelineStage({ ...props, name: name.value }));
  }

  rename(to: string, now: Date): Result<PipelineStage, ValidationError> {
    const name = validName(to);
    if (!name.ok) return name;
    return ok(new PipelineStage({ ...this.p, name: name.value, updatedAt: now }));
  }

  moveTo(position: number, now: Date): Result<PipelineStage, ValidationError> {
    return PipelineStage.create({ ...this.p, position, updatedAt: now });
  }

  remove(now: Date): PipelineStage {
    return new PipelineStage({ ...this.p, deletedAt: now, updatedAt: now });
  }

  get props(): PipelineStageProps {
    return this.p;
  }
}
