import type { Clock, Result, AppError } from "@mallet/shared/types";
import { ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type {
  QboEntityLinkRepository,
  QboSyncLogRepository,
} from "../domain/qbo-sync-repositories";
import { toTimeActivity, type SyncableTimeEntry } from "../domain/time-activity-mapping";

const ENTITY = "time_entry";

export interface SyncApprovedHoursCommand {
  readonly techUserId: string;
  readonly entries: readonly SyncableTimeEntry[];
  readonly defaultItemQboId: string | null;
}

export interface SyncApprovedHoursResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Push a tech's approved hours to QuickBooks.
 *
 * MUST be safe to run twice on the same input. The outbox relay is at-least-once (claim, dispatch
 * and mark are separate transactions), so a redelivery is normal, not exceptional — and a duplicate
 * here is not a cosmetic bug, it is hours paid twice to a real person. The guard is the
 * `qbo_sync_log` partial unique index on succeeded rows, consulted up front and written after every
 * create.
 *
 * Per-entry failures do NOT abort the batch: one unmapped tech should not block the rest of the
 * crew's week. Each failure is recorded with a code the sync log UI can explain and act on.
 */
export class SyncApprovedHours {
  constructor(
    private readonly api: QboApiGateway,
    private readonly links: QboEntityLinkRepository,
    private readonly syncLog: QboSyncLogRepository,
    private readonly clock: Clock,
  ) {}

  async exec(
    cmd: SyncApprovedHoursCommand,
    access: QboAccess,
    orgId: string,
  ): Promise<Result<SyncApprovedHoursResult, AppError>> {
    if (cmd.entries.length === 0) return ok({ sent: 0, skipped: 0, failed: 0 });

    // Idempotency gate. One query for the whole batch rather than per entry.
    const alreadySent = await this.syncLog.succeededIds(
      ENTITY,
      cmd.entries.map((e) => e.id),
    );

    const link = await this.links.find("employee", cmd.techUserId);
    const person = link ? { qboId: link.qboId, kind: link.qboEntityKind ?? "Employee" } : null;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of cmd.entries) {
      if (alreadySent.has(entry.id)) {
        skipped += 1;
        continue;
      }

      const mapped = toTimeActivity(entry, person, cmd.defaultItemQboId);
      if (!mapped.ok) {
        // A break is a normal exclusion, not a problem the shop should be asked to fix; anything
        // else is a real gap (unmapped person, no service item) that belongs in the log as such.
        const isExpectedExclusion = mapped.error.field === "break_not_synced";
        await this.syncLog.record({
          entityType: ENTITY,
          malletId: entry.id,
          qboId: null,
          status: isExpectedExclusion ? "skipped" : "failed",
          errorCode: mapped.error.field ?? "unmappable",
          errorMessage: mapped.error.message,
          attemptedAt: this.clock.now(),
        });
        if (isExpectedExclusion) skipped += 1;
        else failed += 1;
        continue;
      }

      const created = await this.api.createTimeActivity(access, mapped.value);
      if (!created.ok) {
        await this.syncLog.record({
          entityType: ENTITY,
          malletId: entry.id,
          qboId: null,
          status: "failed",
          errorCode: created.error.kind,
          errorMessage: created.error.message,
          attemptedAt: this.clock.now(),
        });
        failed += 1;

        // An expired/rejected token will fail identically for every remaining entry. Stop and let
        // the caller refresh rather than burning the rest of the batch against a dead token.
        if (created.error.kind === "unauthorized") {
          logger.warn({ orgId, sent, failed }, "qbo.sync.aborted_unauthorized");
          return err(created.error);
        }
        continue;
      }

      // Written immediately after the create, so a crash between the two costs at most ONE
      // duplicate on retry rather than a whole batch.
      await this.syncLog.record({
        entityType: ENTITY,
        malletId: entry.id,
        qboId: created.value.id,
        status: "succeeded",
        errorCode: null,
        errorMessage: null,
        attemptedAt: this.clock.now(),
      });
      sent += 1;
    }

    logger.info({ orgId, techUserId: cmd.techUserId, sent, skipped, failed }, "qbo.sync.completed");
    return ok({ sent, skipped, failed });
  }
}
