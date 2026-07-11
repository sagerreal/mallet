import type { ChecklistId, ChecklistItemId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Checklist } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface SetItemRequiredCommand {
  readonly checklistId: ChecklistId;
  readonly itemId: ChecklistItemId;
  readonly required: boolean;
}

export class SetItemRequiredUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: SetItemRequiredCommand, orgId: string): Promise<Result<Checklist, AppError>> {
    const updated = await this.checklists.setItemRequired(
      cmd.checklistId,
      cmd.itemId,
      cmd.required,
      this.clock.now(),
    );
    if (!updated) return err(notFound("checklist or item not found"));
    logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.item_required_set");
    return ok(updated);
  }
}
