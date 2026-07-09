import type { TimeEntryId, Result, AppError } from "@mallet/shared/types";
import { notFound, err, ok } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface RemoveTimeEntryCommand {
  readonly entryId: TimeEntryId;
}

export class RemoveTimeEntryUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: RemoveTimeEntryCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    const count = await this.entries.remove(cmd.entryId, this.clock.now());
    if (count === 0) return err(notFound("time entry not found or already removed"));

    logger.info(
      { entryId: cmd.entryId, orgId },
      "timeEntry.removed",
    );

    return ok({ ok: true });
  }
}
