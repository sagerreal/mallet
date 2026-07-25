import type { TimeEntryId, Result, AppError } from "@mallet/shared/types";
import { notFound, err, ok, conflict } from "@mallet/shared/types";
import type { Clock } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { TimeEntryRepository } from "../domain/time-entry-repository";

export interface RemoveTimeEntryCommand {
  readonly entryId: TimeEntryId;
}

export class RemoveTimeEntryUseCase {
  constructor(
    private readonly entries: TimeEntryRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: RemoveTimeEntryCommand,
    orgId: string,
  ): Promise<Result<{ ok: boolean }, AppError>> {
    // Approved means LOCKED — the same rule UpdateTimeEntry enforces, and for a stronger reason
    // here: approval is what PUSHES hours to QuickBooks. Deleting an approved entry leaves Mallet
    // showing hours the shop never signed off on while QuickBooks still holds the originals, and
    // there is no sync path that would notice. The tech-facing remove endpoint authorises on
    // ownership alone, so without this a technician could quietly delete their own already-paid
    // hours. Reopen (owner/office) is the only way back to editable.
    const entry = await this.entries.findById(cmd.entryId);
    if (!entry) return err(notFound("time entry not found or already removed"));
    if (entry.props.status === "approved") {
      return err(conflict("These hours are approved. Ask the office to reopen them first."));
    }

    const count = await this.entries.remove(cmd.entryId, this.clock.now());
    if (count === 0) return err(notFound("time entry not found or already removed"));

    logger.info(
      { entryId: cmd.entryId, orgId },
      "timeEntry.removed",
    );

    return ok({ ok: true });
  }
}
