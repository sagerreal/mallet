import type { JobId, Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { SiteCapture } from "../domain/site-capture";
import type { MeasurementRepository } from "../domain/measurement-repository";

export interface ListSiteCapturesCommand {
  readonly jobId: JobId;
}

// Lists the not-deleted site captures for a job, as the repository returns them — no reshaping
// needed at this boundary.
export class ListSiteCapturesUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ListSiteCapturesCommand, _orgId: string): Promise<Result<SiteCapture[], AppError>> {
    const captures = await this.repo.listSiteCaptures(cmd.jobId);
    return ok(captures);
  }
}
