import type { Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { OutboxEvent, OutboxHandler, RelayHandlerContext } from "@mallet/shared/outbox";
import type { SyncableTimeEntry } from "../domain/time-activity-mapping";
import type { QboAccess } from "../domain/qbo-api-gateway";
import type { SyncApprovedHoursResult } from "./sync-approved-hours";

/** What the handler needs from the wider app, injected so this file stays free of adapters. */
export interface QboTimeSyncPorts {
  /** The org's connection settings, or null when QuickBooks isn't connected. */
  readonly loadSyncConfig: (
    ctx: RelayHandlerContext,
  ) => Promise<{ enabled: boolean; defaultItemQboId: string | null } | null>;
  /** A usable access token, refreshing first if needed. */
  readonly access: (ctx: RelayHandlerContext) => Promise<Result<QboAccess, AppError>>;
  /** The approved, not-yet-synced entries for this tech on these dates. */
  readonly loadEntries: (
    ctx: RelayHandlerContext,
    techUserId: string,
    dates: readonly string[],
  ) => Promise<readonly SyncableTimeEntry[]>;
  readonly sync: (
    ctx: RelayHandlerContext,
    techUserId: string,
    entries: readonly SyncableTimeEntry[],
    defaultItemQboId: string | null,
    access: QboAccess,
  ) => Promise<Result<SyncApprovedHoursResult, AppError>>;
  readonly markSynced: (ctx: RelayHandlerContext, at: Date) => Promise<void>;
}

const asStringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Turns an approved week into QuickBooks time entries.
 *
 * Registered in trpc/outbox-registry for "timeEntry.weekApproved". The relay is AT-LEAST-ONCE, so
 * this runs more than once for the same week whenever a tick is interrupted — the duplicate guard
 * lives in SyncApprovedHours (the qbo_sync_log unique index), not here.
 *
 * Disposition contract (see shared/outbox/relay): returning a RETRYABLE external_service error
 * leaves the event unpublished for the next tick; anything else is terminal. That mapping matters —
 * a QuickBooks outage should retry, but a shop that simply hasn't connected should not spin
 * forever.
 */
export class QboTimeSyncHandler implements OutboxHandler {
  constructor(
    private readonly ports: QboTimeSyncPorts,
    private readonly clock: Clock,
  ) {}

  async handle(event: OutboxEvent, ctx: RelayHandlerContext): Promise<Result<void, AppError>> {
    const techUserId = typeof event.payload.techUserId === "string" ? event.payload.techUserId : "";
    const dates = asStringArray(event.payload.dates);
    if (!techUserId || dates.length === 0) {
      // A malformed event will never become valid — terminal, not retried.
      logger.warn({ orgId: ctx.orgId }, "qbo.sync.event_missing_fields");
      return ok(undefined);
    }

    const config = await this.ports.loadSyncConfig(ctx);
    // Not connected, or the shop hasn't switched the push on. Both are ordinary states, not
    // failures — connecting QuickBooks must never silently start writing to someone's books.
    if (!config || !config.enabled) return ok(undefined);

    const access = await this.ports.access(ctx);
    if (!access.ok) {
      // A dead connection needs the shop to reconnect; retrying can't fix it. Only genuinely
      // transient problems go back on the queue.
      const retryable = access.error.kind === "external_service" && access.error.retryable;
      if (!retryable) {
        logger.warn({ orgId: ctx.orgId, kind: access.error.kind }, "qbo.sync.no_access_terminal");
        return ok(undefined);
      }
      return err(access.error);
    }

    const entries = await this.ports.loadEntries(ctx, techUserId, dates);
    if (entries.length === 0) return ok(undefined);

    const result = await this.ports.sync(
      ctx,
      techUserId,
      entries,
      config.defaultItemQboId,
      access.value,
    );
    if (!result.ok) {
      if (result.error.kind === "external_service" && result.error.retryable) {
        return err(result.error);
      }
      // Per-entry failures are already recorded in the sync log with actionable codes; re-running
      // the whole week would not fix them, so don't spin the relay on it.
      logger.warn({ orgId: ctx.orgId, kind: result.error.kind }, "qbo.sync.terminal_failure");
      return ok(undefined);
    }

    if (result.value.sent > 0) {
      await this.ports.markSynced(ctx, this.clock.now());
    }

    logger.info({ orgId: ctx.orgId, ...result.value }, "qbo.sync.week_pushed");
    return ok(undefined);
  }
}

/** Convenience for callers that need the standard retryable wrapper. */
export const retryableQbo = (message: string): AppError =>
  externalService("quickbooks", message, true);
