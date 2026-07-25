import type { UserId, Result, AppError } from "@mallet/shared/types";
import { ok, err, validation } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { EventBus } from "@mallet/shared/ports";
import type { OrgId } from "@mallet/shared/types";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface ApproveWeekCommand {
  readonly techUserId: UserId;
  readonly dates: string[]; // YYYY-MM-DD array
}

/** Field on the refusal so the UI can name the offending days instead of saying "failed". */
export const UNFINISHED_DAYS = "unfinishedDays";

export class ApproveWeekUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
    // Optional so existing callers/tests are unaffected; when present, approval becomes the trigger
    // for downstream work (today: the QuickBooks push). Emitted through the tx-bound outbox bus, so
    // the event is never published for an approval that rolled back.
    private readonly bus?: EventBus,
  ) {}

  async exec(
    cmd: ApproveWeekCommand,
    orgId: string,
  ): Promise<Result<{ approved: number }, AppError>> {
    // Refuse the WHOLE week if any day is unfinished, rather than approving the finished rows and
    // leaving the rest behind. Approval is the shop's signature on a week and the only trigger for
    // hours leaving Mallet; a partial approval hides the omission exactly where nobody looks. The
    // offending dates travel in the error so the grid can name them.
    const unfinished = await this.entries.unfinishedDates(cmd.techUserId, cmd.dates);
    if (unfinished.length > 0) {
      logger.info(
        { techUserId: cmd.techUserId, orgId, unfinished },
        "timeEntry.approveWeek.refusedUnfinished",
      );
      return err(
        validation(
          `These days still have hours with no end time: ${unfinished.join(", ")}. Finish or remove them, then approve.`,
          UNFINISHED_DAYS,
        ),
      );
    }

    const count = await this.entries.approveWeek(cmd.techUserId, cmd.dates, this.clock.now());

    logger.info(
      { techUserId: cmd.techUserId, orgId, dates: cmd.dates, approved: count },
      "timeEntry.weekApproved",
    );

    // Only emit when something actually changed — re-approving an already-approved week should not
    // re-trigger a downstream push.
    if (this.bus && count > 0) {
      await this.bus.emit({
        name: "timeEntry.weekApproved",
        orgId: orgId as OrgId,
        payload: { techUserId: cmd.techUserId, dates: cmd.dates, approved: count },
        occurredAt: this.clock.now(),
      });
    }

    return ok({ approved: count });
  }
}
