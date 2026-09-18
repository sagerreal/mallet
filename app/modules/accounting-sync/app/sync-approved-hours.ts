import type { Clock, Result, AppError } from "@mallet/shared/types";
import { ok, err } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type {
  QboEntityLinkRepository,
  QboSyncLogRepository,
} from "../domain/qbo-sync-repositories";
import type { SyncableTimeEntry } from "../domain/time-activity-mapping";
import { toDayTotals, toDayTimeActivity, dayKey } from "../domain/day-total-mapping";

/**
 * The unit pushed to QuickBooks is a person's DAY, not a time entry.
 *
 * `qbo_sync_log` keys on (org, entity_type, mallet_id), so changing the unit changes the key —
 * mallet_id becomes `"<techUserId>:<workDate>"`. The entity type changes with it so a day's row can
 * never collide with an entry row written before this, and so an old entry-level success cannot
 * suppress the day that replaces it.
 */
const ENTITY = "time_day";

/**
 * The unit this used to push. Rows under it are days ALREADY IN QUICKBOOKS, one activity per entry.
 *
 * They must still suppress the day that replaces them, or the first sync after this change re-sends
 * every week the old code had already sent — as a day total, on top of the per-entry rows already
 * sitting there. That is hours paid twice, which is the one failure this whole file is arranged to
 * prevent. Cheaper and safer than back-filling the log, and it needs no migration.
 */
const LEGACY_ENTITY = "time_entry";

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
    const [alreadySent, legacySent] = await Promise.all([
      this.syncLog.succeededIds(
        ENTITY,
        [...new Set(cmd.entries.map((e) => dayKey(e.techUserId, e.workDate)))],
      ),
      // Entry ids pushed by the old per-entry code. Any hit means that day is already in QuickBooks.
      this.syncLog.succeededIds(
        LEGACY_ENTITY,
        cmd.entries.map((e) => e.id),
      ),
    ]);

    const link = await this.links.find("employee", cmd.techUserId);
    const person = link ? { qboId: link.qboId, kind: link.qboEntityKind ?? "Employee" } : null;

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    /**
     * One activity per DAY. QuickBooks runs payroll and is paid for HOURS — what each hour was
     * spent on is Mallet's costing and stays here, which is how Jobber and Housecall Pro both work.
     *
     * A day that cannot be totalled refuses as a whole rather than sending part of itself: a day
     * short by one entry is a short paycheque that looks correct.
     */
    const grouped = toDayTotals(cmd.entries);
    if (!grouped.ok) {
      await this.syncLog.record({
        entityType: ENTITY,
        malletId: cmd.techUserId,
        qboId: null,
        status: "failed",
        errorCode: grouped.error.field ?? "unmappable",
        errorMessage: grouped.error.message,
        attemptedAt: this.clock.now(),
      });
      return ok({ sent: 0, skipped: 0, failed: 1 });
    }

    for (const day of grouped.value) {
      const key = dayKey(day.techUserId, day.workDate);
      // Sent as a day, OR any part of it sent as an entry by the old code. Either way those hours
      // are already in QuickBooks and sending the day again would duplicate them.
      if (alreadySent.has(key) || day.entryIds.some((id) => legacySent.has(id))) {
        skipped += 1;
        continue;
      }

      const mapped = toDayTimeActivity(day, person, cmd.defaultItemQboId);
      if (!mapped.ok) {
        await this.syncLog.record({
          entityType: ENTITY,
          malletId: key,
          qboId: null,
          status: "failed",
          errorCode: mapped.error.field ?? "unmappable",
          errorMessage: mapped.error.message,
          attemptedAt: this.clock.now(),
        });
        failed += 1;
        continue;
      }

      const created = await this.api.createTimeActivity(access, mapped.value);
      if (!created.ok) {
        await this.syncLog.record({
          entityType: ENTITY,
          malletId: key,
          qboId: null,
          status: "failed",
          errorCode: created.error.kind,
          errorMessage: created.error.message,
          attemptedAt: this.clock.now(),
        });
        failed += 1;

        // An expired/rejected token will fail identically for every remaining day. Stop and let
        // the caller refresh rather than burning the rest of the batch against a dead token.
        if (created.error.kind === "unauthorized") {
          logger.warn({ orgId, sent, failed }, "qbo.sync.aborted_unauthorized");
          return err(created.error);
        }
        continue;
      }

      await this.syncLog.record({
        entityType: ENTITY,
        malletId: key,
        qboId: created.value.id,
        status: "succeeded",
        errorCode: null,
        errorMessage: null,
        attemptedAt: this.clock.now(),
      });
      sent += 1;
    }

    logger.info({ orgId, techUserId: cmd.techUserId, sent, skipped, failed }, "qbo.hours.synced");
    return ok({ sent, skipped, failed });
  }
}
