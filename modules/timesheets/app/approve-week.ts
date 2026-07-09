import type { UserId, Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface ApproveWeekCommand {
  readonly techUserId: UserId;
  readonly dates: string[]; // YYYY-MM-DD array
}

export class ApproveWeekUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: ApproveWeekCommand,
    orgId: string,
  ): Promise<Result<{ approved: number }, AppError>> {
    const count = await this.entries.approveWeek(cmd.techUserId, cmd.dates, this.clock.now());

    logger.info(
      { techUserId: cmd.techUserId, orgId, dates: cmd.dates, approved: count },
      "timeEntry.weekApproved",
    );

    return ok({ approved: count });
  }
}
