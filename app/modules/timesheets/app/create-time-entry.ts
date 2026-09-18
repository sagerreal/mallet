import type { UserId, JobId, Result, AppError, TimeEntryId } from "@mallet/shared/types";
import { validation, err, ok, asOrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntry, TimeEntryKind, TimeEntrySrc } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { overlapGateError } from "./overlap-gate";
import { reopenSubmissionForNewHours } from "./submit-week";
import { weekStartOf } from "../domain/week-submission";
import type { WeekSubmissionRepository } from "../domain/week-submission-repository";
import { toPage } from "@mallet/shared/types";

export interface CreateTimeEntryCommand {
  readonly id?: string; // client-authored; minted here when absent
  readonly techUserId: UserId;
  readonly jobId: JobId | null;
  readonly workDate: string;
  readonly kind: TimeEntryKind;
  readonly startTime: string | null;
  readonly endTime: string | null;
  /** Time-off length; null on clock kinds. The domain's shape matrix is the real guard. */
  readonly minutes: number | null;
  readonly note: string;
  readonly src: TimeEntrySrc;
  readonly running: boolean;
  /** Whose hand typed this (null = a system write). Stamped onto the row for payroll review. */
  readonly editedBy: UserId | null;
}

export class CreateTimeEntryUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    /**
     * Optional so the many call sites that never write into a closed week need not know about
     * submissions at all. Passed by the router, which does.
     */
    private readonly submissions?: WeekSubmissionRepository,
  ) {}

  async exec(
    cmd: CreateTimeEntryCommand,
    orgId: string,
  ): Promise<Result<TimeEntry, AppError>> {
    if (!cmd.workDate) return err(validation("workDate is required", "workDate"));

    // One person cannot be two places at once: refuse a row that shares a moment with any other
    // row on this tech's day, or the day's total double-counts straight into payroll. Time-off
    // rows occupy no wall-clock window, so only punched rows face the gate.
    if (cmd.startTime !== null) {
      const gate = await overlapGateError(this.entries, {
        id: cmd.id,
        kind: cmd.kind,
        techUserId: cmd.techUserId,
        workDate: cmd.workDate,
        startTime: cmd.startTime,
        endTime: cmd.endTime,
        running: cmd.running,
      });
      if (gate !== null) return err(gate);
    }

    const entry = await this.entries.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      techUserId: cmd.techUserId,
      jobId: cmd.jobId,
      workDate: cmd.workDate,
      kind: cmd.kind,
      startTime: cmd.startTime,
      endTime: cmd.endTime,
      minutes: cmd.minutes,
      note: cmd.note,
      src: cmd.src,
      status: "draft",
      running: cmd.running,
      editedByUserId: cmd.editedBy,
    });

    logger.info(
      { entryId: entry.props.id, orgId, techUserId: cmd.techUserId, workDate: cmd.workDate },
      "timeEntry.created",
    );

    /**
     * NEW HOURS UNSIGN A SIGNED WEEK.
     *
     * A submission says "these are my hours". Add hours to that week afterwards and the sentence
     * is no longer true — the person attested to a week that has since grown. Only the OFFICE can
     * reach this (a technician writing into their own submitted week is refused upstream), which
     * is exactly the case that needs it: hours added on somebody's behalf, without them seeing.
     *
     * This used to live in the clock, which was exempt from the submitted-week lock because you
     * cannot refuse a tap from a person who is genuinely working. The clock is gone; the property
     * is not, so it moved to the only writer left.
     */
    if (this.submissions !== undefined) {
      await reopenSubmissionForNewHours(this.submissions, {
        orgId: asOrgId(orgId),
        techUserId: cmd.techUserId,
        weekStart: weekStartOf(cmd.workDate),
        reason: "new hours landed after you submitted",
        now: this.clock.now(),
      });
    }

    return ok(entry);
  }

}
