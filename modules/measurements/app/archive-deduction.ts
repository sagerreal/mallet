import type { Result, AppError } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { MeasurementRepository } from "../domain/measurement-repository";

export interface ArchiveDeductionCommand {
  readonly deductionId: string;
}

// Soft-deletes a deduction, putting that wall area back into the room's paintable total. Same
// no-silent-fail contract as ArchiveRoomUseCase: zero rows affected (missing / wrong org / already
// archived) is a surfaced not_found, never a quiet success — removing a deduction CHANGES WHAT THE
// JOB COSTS, so a no-op that reports success would leave an estimator looking at the old number.
export class ArchiveDeductionUseCase {
  constructor(private readonly repo: MeasurementRepository) {}

  async exec(cmd: ArchiveDeductionCommand, orgId: string): Promise<Result<{ ok: true }, AppError>> {
    const affected = await this.repo.archiveDeduction(cmd.deductionId);
    if (affected === 0) return err(notFound("deduction not found or already removed"));

    logger.info({ deductionId: cmd.deductionId, orgId }, "measurements.deduction_archived");

    return ok({ ok: true });
  }
}
