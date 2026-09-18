import type { Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { MeasurementRepository } from "../domain/measurement-repository";

export interface ArchiveSiteCaptureCommand {
  readonly captureId: string;
}

// Soft-deletes a site capture. Same no-silent-fail contract as ArchiveRoomUseCase: a
// zero-rows-affected result (missing / wrong org / already archived) is a surfaced not_found,
// never a quiet no-op success.
export class ArchiveSiteCaptureUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ArchiveSiteCaptureCommand, orgId: string): Promise<Result<{ ok: true }, AppError>> {
    const affected = await this.repo.archiveSiteCapture(cmd.captureId);
    if (affected === 0) return err(notFound("site capture not found or already archived"));

    logger.info({ captureId: cmd.captureId, orgId }, "measurements.site_capture_archived");

    return ok({ ok: true });
  }
}
