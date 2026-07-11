import type { ChecklistId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { ChecklistRepository } from "../domain/checklist-repository";

export interface ArchiveChecklistCommand {
  readonly checklistId: ChecklistId;
}

export class ArchiveChecklistUseCase {
  constructor(
    private readonly checklists: ChecklistRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ArchiveChecklistCommand, orgId: string): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.checklists.archive(cmd.checklistId, this.clock.now());
    if (count === 0) return err(notFound("checklist not found or already archived"));
    logger.info({ checklistId: cmd.checklistId, orgId }, "checklist.archived");
    return ok({ ok: true });
  }
}
