import type { Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { MeasurementRepository } from "../domain/measurement-repository";

export interface ArchiveRoomCommand {
  readonly captureId: string;
}

// Soft-deletes a room capture. Same no-silent-fail contract as CompanyRepository.archive: a
// zero-rows-affected result (missing / wrong org / already archived) is a surfaced not_found,
// never a quiet no-op success.
export class ArchiveRoomUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ArchiveRoomCommand, orgId: string): Promise<Result<{ ok: true }, AppError>> {
    const affected = await this.repo.archive(cmd.captureId);
    if (affected === 0) return err(notFound("room capture not found or already archived"));

    logger.info({ captureId: cmd.captureId, orgId }, "measurements.room_archived");

    return ok({ ok: true });
  }
}
