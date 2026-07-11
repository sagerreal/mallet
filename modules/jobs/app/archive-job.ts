import type { JobId, Result, AppError, Clock } from "@mallet/shared/types";
import { notFound, ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { JobRepository } from "../domain/job-repository";

export interface ArchiveJobCommand {
  readonly jobId: JobId;
}

// Soft-delete a job (deleted_at). Idempotent-safe: a second archive returns NOT_FOUND
// (mirrors ArchiveCompanyUseCase).
export class ArchiveJobUseCase {
  constructor(
    private readonly repo: JobRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: ArchiveJobCommand): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.repo.archive(cmd.jobId, this.clock.now());
    if (count === 0) return err(notFound("job not found or already archived"));
    logger.info({ jobId: cmd.jobId }, "job.archived");
    return ok({ ok: true });
  }
}
