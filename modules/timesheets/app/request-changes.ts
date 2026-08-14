import type { Clock, Result, AppError, OrgId, UserId } from "@mallet/shared/types";
import { ok, err, conflict, validation } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { WeekSubmissionRepository } from "../domain/week-submission-repository";

/**
 * modules/timesheets/app/request-changes.ts
 * The office hands a submitted week back to the technician, with a reason.
 *
 * Until now an approver had two moves: approve it, or fix it themselves. Fixing somebody else's
 * hours is a poor third option — the man who was there knows what happened on Wednesday, and an
 * office edit made on his behalf is a change to his pay that he never saw.
 *
 * REQUIRES A LIVE ATTESTATION. Reopening is the act of retracting a sign-off, so there has to be a
 * sign-off to retract. A week the technician never submitted has nothing to hand back — the office
 * either edits it or speaks to him, and pretending otherwise would mean writing a `submittedAt` he
 * never made. Already reopened is a no-op that reports success: the week is already with him, which
 * is exactly what the caller wanted.
 *
 * THE REASON IS REQUIRED. "Please look at this again" with no reason sends a man back to a week of
 * his own hours to guess which day is wrong, and the whole point is that he knows something the
 * approver does not.
 */

const MAX_REASON = 300;

export interface RequestChangesCommand {
  readonly techUserId: string;
  readonly weekStart: string;
  readonly reason: string;
}

export class RequestChangesUseCase {
  constructor(
    private readonly submissions: WeekSubmissionRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: RequestChangesCommand, orgId: OrgId): Promise<Result<{ reopened: boolean }, AppError>> {
    const reason = cmd.reason.trim();
    if (reason.length === 0) {
      return err(validation("Say what needs changing — he cannot guess which day.", "reason"));
    }
    if (reason.length > MAX_REASON) {
      return err(validation(`Keep it under ${MAX_REASON} characters.`, "reason"));
    }

    const existing = await this.submissions.findFor(cmd.techUserId as UserId, cmd.weekStart);
    if (existing === null) {
      return err(
        conflict(
          "This week has not been submitted yet, so there is nothing to hand back. Edit it here, or ask them to submit it first.",
        ),
      );
    }
    // Already back with him. Reporting success is honest — the caller wanted the week in his hands
    // and it is — and it keeps a double-tap on a batch from reading as a failure.
    if (!existing.isActive()) return ok({ reopened: false });

    await this.submissions.save(existing.reopen(reason, this.clock.now()));
    logger.info(
      { orgId, techUserId: cmd.techUserId, weekStart: cmd.weekStart },
      "timesheet.changesRequested",
    );
    return ok({ reopened: true });
  }
}
