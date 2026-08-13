import type { TimeEntryId, JobId, UserId, Result, AppError } from "@mallet/shared/types";
import { notFound, err, ok, conflict } from "@mallet/shared/types";
import { overlapGateError } from "./overlap-gate";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntry, TimeEntryKind, TimeEntrySrc } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface UpdateTimeEntryCommand {
  readonly entryId: TimeEntryId;
  readonly jobId?: JobId | null;
  readonly workDate?: string;
  readonly kind?: TimeEntryKind;
  readonly startTime?: string | null;
  readonly endTime?: string | null;
  readonly minutes?: number | null;
  readonly note?: string;
  readonly src?: TimeEntrySrc;
  readonly running?: boolean;
  /** Whose hand made this edit (null = a system write). Signs the row for payroll review. */
  readonly editedBy?: UserId | null;
}

export class UpdateTimeEntryUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: UpdateTimeEntryCommand,
    orgId: string,
  ): Promise<Result<TimeEntry, AppError>> {
    const entry = await this.entries.findById(cmd.entryId);
    if (!entry) return err(notFound("time entry not found"));

    // Approved means LOCKED. Without this an approved entry could be rewritten while approvedAt
    // stayed set — so the record would claim the shop signed off on hours it never saw, and (once
    // already pushed) QuickBooks would hold different numbers than Mallet shows. Reopen is the only
    // legitimate way back to editable, and it goes through ReopenEntry, not here.
    if (entry.props.status === "approved") {
      return err(
        conflict("These hours are approved. Reopen the entry before changing it."),
      );
    }

    const now = this.clock.now();
    const patched = entry.patch(
      {
        jobId: cmd.jobId !== undefined ? cmd.jobId : entry.props.jobId,
        workDate: cmd.workDate !== undefined ? cmd.workDate : entry.props.workDate,
        kind: cmd.kind !== undefined ? cmd.kind : entry.props.kind,
        startTime: cmd.startTime !== undefined ? cmd.startTime : entry.props.startTime,
        endTime: cmd.endTime !== undefined ? cmd.endTime : entry.props.endTime,
        minutes: cmd.minutes !== undefined ? cmd.minutes : entry.props.minutes,
        note: cmd.note !== undefined ? cmd.note : entry.props.note,
        src: cmd.src !== undefined ? cmd.src : entry.props.src,
        running: cmd.running !== undefined ? cmd.running : entry.props.running,
      },
      now,
      cmd.editedBy ?? undefined,
    );
    if (!patched.ok) return patched;

    // One person cannot be two places at once — the same gate as create, run against the day
    // the row is landing ON (workDate may itself be the patch). The row never clashes with
    // itself. Time-off rows occupy no wall-clock window, so only punched rows face the gate.
    const p = patched.value.props;
    if (p.startTime !== null) {
      const gate = await overlapGateError(this.entries, {
        id: p.id,
        techUserId: p.techUserId,
        workDate: p.workDate,
        startTime: p.startTime,
        endTime: p.endTime,
        running: p.running,
      });
      if (gate !== null) return err(gate);
    }

    await this.entries.save(patched.value);

    logger.info(
      { entryId: cmd.entryId, orgId },
      "timeEntry.updated",
    );

    return ok(patched.value);
  }
}
