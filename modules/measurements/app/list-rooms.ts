import type { JobId, Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { MeasurementRepository, RoomCaptureWithQuantities } from "../domain/measurement-repository";

export interface ListRoomsCommand {
  readonly jobId: JobId;
}

// Lists the current (not superseded, not deleted) room captures for a job, as the repository
// returns them — no reshaping needed at this boundary.
export class ListRoomsUseCase {
  constructor(
    private readonly repo: MeasurementRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: ListRoomsCommand, _orgId: string): Promise<Result<RoomCaptureWithQuantities[], AppError>> {
    const rooms = await this.repo.listByJob(cmd.jobId);
    return ok(rooms);
  }
}
