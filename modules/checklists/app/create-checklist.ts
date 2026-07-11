import type { Result, AppError, Clock } from "@mallet/shared/types";
import { validation, ok, err, asChecklistId, asOrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { Checklist } from "../domain/checklist";
import { isChecklistStage } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface CreateChecklistCommand {
  readonly id?: string;
  readonly name: string;
  readonly trade: string;
  readonly stage: string;
  readonly match: readonly string[];
}

export class CreateChecklistUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateChecklistCommand, orgId: string): Promise<Result<Checklist, AppError>> {
    const name = cmd.name.trim();
    if (name.length === 0) return err(validation("checklist name is required", "name"));
    if (!isChecklistStage(cmd.stage)) return err(validation(`unknown checklist stage: ${cmd.stage}`, "stage"));

    const checklist = await this.checklists.create({
      id: asChecklistId(cmd.id ?? this.ids.newId()),
      orgId: asOrgId(orgId),
      name,
      trade: cmd.trade,
      stage: cmd.stage,
      match: cmd.match,
    });

    logger.info({ checklistId: checklist.props.id, orgId }, "checklist.created");
    return ok(checklist);
  }
}
