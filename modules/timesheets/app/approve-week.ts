import type { UserId, Result, AppError } from "@mallet/shared/types";
import { ok } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { EventBus } from "@mallet/shared/ports";
import type { OrgId } from "@mallet/shared/types";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface ApproveWeekCommand {
  readonly techUserId: UserId;
  readonly dates: string[]; // YYYY-MM-DD array
}

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
