import type { UserId, OrgId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, conflict } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { IdGenerator } from "@mallet/shared/ports";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import type { WeekSubmissionRepository } from "../domain/week-submission-repository";
import type { WeekSubmission } from "../domain/week-submission";

export interface SubmitWeekCommand {
  readonly techUserId: UserId;
  readonly weekStart: string; // Monday, YYYY-MM-DD — validated by the domain on claim/resubmit
}

/**
 * The technician signs a week off. Idempotent by construction: the claim rides the unique
 * (org, tech, week) — a replayed submit returns the standing attestation instead of minting a
 * second one; a submit after a reopen re-signs the same row.
 *
 * ONE refusal here: a running clock. Submitting mid-stretch would attest hours that are still
 * being written. Missing-day WARNINGS deliberately live client-side — a day off is not the
 * server's to wall.
 */
export class SubmitWeekUseCase {
  constructor(
    private readonly submissions: WeekSubmissionRepository,
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SubmitWeekCommand, orgId: OrgId): Promise<Result<WeekSubmission, AppError>> {
    const open = await this.entries.findOpenForTech(cmd.techUserId);
    if (open !== null) {
      return err(conflict("End the day before submitting the week."));
    }

    const now = this.clock.now();
    const { submission, created } = await this.submissions.claim({
      id: this.ids.newId(),
      orgId,
      techUserId: cmd.techUserId,
      weekStart: cmd.weekStart,
      submittedAt: now,
    });

    if (created) {
      logger.info(
        { orgId, techUserId: cmd.techUserId, weekStart: cmd.weekStart },
        "timesheet.submitted",
      );
      return ok(submission);
    }

    if (submission.isActive()) {
      // The double-tap / retry case: the attestation already stands. Returning it unchanged is
      // the idempotent answer — not an error, nothing to redo.
      return ok(submission);
    }

    // Reopened (new hours landed after the last sign-off) — this submit is the re-signing.
    const again = submission.resubmit(now);
    await this.submissions.save(again);
    logger.info(
      { orgId, techUserId: cmd.techUserId, weekStart: cmd.weekStart },
      "timesheet.resubmitted",
    );
    return ok(again);
  }
}

/**
 * New hours landed on a submitted week — reopen the attestation rather than refuse the hours.
 * The clock outranks the submission (payroll-first: the clock never refuses), and a signature
 * over a week that has since grown is not a signature.
 *
 * Never throws and never fails the write it rides behind: called AFTER the entry landed, in the
 * same transaction, so the reopen and the hours commit or roll back together.
 */
export async function reopenSubmissionForNewHours(
  submissions: WeekSubmissionRepository,
  args: {
    readonly orgId: OrgId;
    readonly techUserId: UserId;
    readonly weekStart: string;
    readonly reason: string;
    readonly now: Date;
  },
): Promise<void> {
  const existing = await submissions.findFor(args.techUserId, args.weekStart);
  if (existing === null || !existing.isActive()) return;
  await submissions.save(existing.reopen(args.reason, args.now));
  logger.info(
    { orgId: args.orgId, techUserId: args.techUserId, weekStart: args.weekStart, reason: args.reason },
    "timesheet.reopened",
  );
}

/**
 * The submitted-week refusal, phrased ONCE so the paths that enforce it cannot drift.
 *
 * A CONFLICT, not a validation error: nothing about the request is malformed — the week's current
 * state disallows the change, the same shape as the approved-entry lock in UpdateTimeEntryUseCase.
 */
export const SUBMITTED_WEEK_MESSAGE =
  "This week is with the office — it was submitted. Ask the office to change it.";

export const submittedWeekError = (): AppError => conflict(SUBMITTED_WEEK_MESSAGE);
