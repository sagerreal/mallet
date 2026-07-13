import type { MaterialId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { MaterialRepository } from "../domain/material-repository";

export interface ArchiveMaterialCommand {
  readonly materialId: MaterialId;
}

export class ArchiveMaterialUseCase {
  constructor(
    private readonly repo: MaterialRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: ArchiveMaterialCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archive(cmd.materialId, this.clock.now());
    if (count === 0) return err(notFound("material not found or already archived"));

    logger.info({ materialId: cmd.materialId, orgId }, "pricebook.material.archived");

    return ok({ ok: true });
  }
}
