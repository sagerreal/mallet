import type { ChecklistId, ChecklistItemId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { Checklist } from "../domain/checklist";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface RemoveItemCommand {
  readonly checklistId: ChecklistId;
  readonly itemId: ChecklistItemId;
}

export class RemoveItemUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RemoveItemCommand, orgId: string): Promise<Result<Checklist, AppError>> {
    const updated = await this.checklists.removeItem(cmd.checklistId, cmd.itemId, this.clock.now());
    if (!updated) return err(notFound("checklist or item not found"));
    logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.item_removed");
    return ok(updated);
  }
}
