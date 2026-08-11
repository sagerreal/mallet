import type { UserId, JobId, Result, AppError } from "@mallet/shared/types";
import { validation, err, ok } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntry, TimeEntryKind, TimeEntrySrc } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { overlapGateError } from "./overlap-gate";

export interface CreateTimeEntryCommand {
  readonly id?: string; // client-authored; minted here when absent
  readonly techUserId: UserId;
  readonly jobId: JobId | null;
  readonly workDate: string;
  readonly kind: TimeEntryKind;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly note: string;
  readonly src: TimeEntrySrc;
  readonly running: boolean;
}

export class CreateTimeEntryUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(
    cmd: CreateTimeEntryCommand,
    orgId: string,
  ): Promise<Result<TimeEntry, AppError>> {
    if (!cmd.workDate) return err(validation("workDate is required", "workDate"));

    // One person cannot be two places at once: refuse a row that shares a moment with any other
    // row on this tech's day, or the day's total double-counts straight into payroll.
    const gate = await overlapGateError(this.entries, {
      id: cmd.id,
      techUserId: cmd.techUserId,
      workDate: cmd.workDate,
      startTime: cmd.startTime,
      endTime: cmd.endTime,
      running: cmd.running,
    });
    if (gate !== null) return err(gate);

    const entry = await this.entries.create({
      id: cmd.id ?? this.ids.newId(),
      orgId,
      techUserId: cmd.techUserId,
      jobId: cmd.jobId,
      workDate: cmd.workDate,
      kind: cmd.kind,
      startTime: cmd.startTime,
      endTime: cmd.endTime,
      note: cmd.note,
      src: cmd.src,
      status: "draft",
      running: cmd.running,
    });

    logger.info(
      { entryId: entry.props.id, orgId, techUserId: cmd.techUserId, workDate: cmd.workDate },
      "timeEntry.created",
    );

    return ok(entry);
  }
}
