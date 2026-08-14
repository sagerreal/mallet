import type { UserId, JobId, Result, AppError, TimeEntryId } from "@mallet/shared/types";
import { validation, err, ok } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntry, TimeEntryKind, TimeEntrySrc } from "../domain/time-entry";
import type { TimeEntryRepository } from "../domain/time-entry-repository";
import { overlapGateError } from "./overlap-gate";
import { planCarve } from "../domain/carve";
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
      /**
       * ATTRIBUTING TIME IS NOT A COLLISION.
       *
       * The clock is a state machine, so regular time claims every minute of a shift and the gate
       * below refused anything landing inside it. That refusal is right for two shifts and wrong for
       * the commonest office action there is: a technician clocked ten hours of regular time without
       * ever switching state, and somebody now wants to say three of them were on J-1039.
       *
       * Job time is a SUBDIVISION of regular time, so the regular row is cut around the new one
       * instead. Paid minutes are unchanged either way — see domain/carve.ts, which owns that
       * invariant and is tested on it.
       */
      const carved = await this.carveRegularTime(cmd, orgId);
      if (!carved.ok) return carved;

      const gate = await overlapGateError(this.entries, {
        id: cmd.id,
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

    return ok(entry);
  }

  /**
   * Cut a stretch of regular time around a row being attributed to a job.
   *
   * Runs BEFORE the overlap gate, so a carvable write clears the day first and the gate then finds
   * nothing to refuse. Anything the plan will not carve — a break, travel, another job, a running
   * row, or a row straddling two — is left exactly as it was, and the gate refuses it in its own
   * words. This never invents a refusal of its own.
   *
   * Only ATTRIBUTED rows carve. A new regular row landing inside another regular row is somebody
   * double-entering a shift, which is the collision the gate exists for.
   */
  private async carveRegularTime(
    cmd: CreateTimeEntryCommand,
    orgId: string,
  ): Promise<Result<void, AppError>> {
    if (cmd.kind !== "job" || cmd.jobId === null || cmd.startTime === null || cmd.endTime === null) {
      return ok(undefined);
    }
    const day = await this.entries.list(
      { techUserId: cmd.techUserId, fromDate: cmd.workDate, toDate: cmd.workDate },
      toPage({ limit: 200, cursor: null }),
    );
    // A second page holds rows this never saw; leave the day alone and let the gate say so.
    if (day.nextCursor !== null) return ok(undefined);

    const rows = day.items
      .map((e) => e.props)
      .filter((p): p is typeof p & { startTime: string } => p.startTime !== null && p.id !== cmd.id)
      .map((p) => ({ id: p.id, kind: p.kind, startTime: p.startTime, endTime: p.endTime }));

    const plan = planCarve({ startTime: cmd.startTime, endTime: cmd.endTime }, rows);
    if (plan.action === "none" || plan.action === "refuse") return ok(undefined);

    const host = day.items.find((e) => e.props.id === plan.hostId);
    if (!host) return ok(undefined);

    if (plan.action === "replace") {
      // Nothing of the regular row survives — the job row takes its whole window.
      await this.entries.remove(host.props.id as TimeEntryId, this.clock.now());
      return ok(undefined);
    }

    if (plan.action === "trim") {
      const moved = host.patch(
        { startTime: plan.startTime, endTime: plan.endTime },
        this.clock.now(),
        cmd.editedBy ?? undefined,
      );
      if (!moved.ok) return moved;
      await this.entries.save(moved.value);
      return ok(undefined);
    }

    // split: the head keeps the host's id so its history stays put; the tail is a new row.
    const head = host.patch({ endTime: plan.hostEndTime }, this.clock.now(), cmd.editedBy ?? undefined);
    if (!head.ok) return head;
    await this.entries.save(head.value);
    await this.entries.create({
      id: this.ids.newId(),
      orgId,
      techUserId: cmd.techUserId,
      jobId: null,
      workDate: cmd.workDate,
      kind: host.props.kind,
      startTime: plan.tailStartTime,
      endTime: plan.tailEndTime,
      minutes: null,
      note: host.props.note,
      src: host.props.src,
      status: "draft",
      running: false,
      editedByUserId: cmd.editedBy,
    });
    logger.info(
      { orgId, techUserId: cmd.techUserId, workDate: cmd.workDate, hostId: plan.hostId },
      "timeEntry.regularCarved",
    );
    return ok(undefined);
  }
}
