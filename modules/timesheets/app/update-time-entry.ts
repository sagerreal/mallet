import type { TimeEntryId, JobId, Result, AppError } from "@mallet/shared/types";
import { notFound, err, ok, conflict } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntry, TimeEntryKind, TimeEntrySrc } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface UpdateTimeEntryCommand {
  readonly entryId: TimeEntryId;
  readonly jobId?: JobId | null;
  readonly workDate?: string;
  readonly kind?: TimeEntryKind;
  readonly startTime?: string;
  readonly endTime?: string | null;
  readonly note?: string;
  readonly src?: TimeEntrySrc;
  readonly running?: boolean;
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
        note: cmd.note !== undefined ? cmd.note : entry.props.note,
        src: cmd.src !== undefined ? cmd.src : entry.props.src,
        running: cmd.running !== undefined ? cmd.running : entry.props.running,
      },
      now,
    );
    if (!patched.ok) return patched;

    await this.entries.save(patched.value);

    logger.info(
      { entryId: cmd.entryId, orgId },
      "timeEntry.updated",
    );

    return ok(patched.value);
  }
}
