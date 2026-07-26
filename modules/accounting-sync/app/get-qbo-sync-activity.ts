import type { QboSyncLogRepository, SyncOutcome } from "../domain/qbo-sync-repositories";
import type { SyncLabelReader } from "../domain/sync-label-reader";
import { explainSyncProblem, type SyncProblem } from "../domain/sync-problem";

/** How many attempts the card shows. Enough to cover a payroll week without becoming a report. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface QboSyncActivityRow {
  readonly entityType: string;
  readonly malletId: string;
  /** What the shop recognises — a name and date, not a UUID. */
  readonly label: string;
  readonly status: SyncOutcome;
  readonly qboId: string | null;
  /** Null on success. */
  readonly problem: SyncProblem | null;
  /** QuickBooks' own words, when it gave any. Shown under the explanation, never instead of it. */
  readonly detail: string | null;
  readonly attemptedAt: Date;
}

export interface QboSyncActivity {
  readonly rows: readonly QboSyncActivityRow[];
  /** How many of these could be sent again once their cause is fixed — drives the retry control. */
  readonly retryableCount: number;
}

/**
 * What the QuickBooks card shows about what actually happened.
 *
 * This exists because until now nothing read `qbo_sync_log` at all: a push that failed — an
 * unmatched person, a revoked token — looked exactly like one that worked, and the only way to
 * find out was to query the database. That is the silent failure the house rules forbid, and it
 * matters more than usual here because the thing failing silently is somebody's pay.
 */
export class GetQboSyncActivity {
  constructor(
    private readonly syncLog: QboSyncLogRepository,
    private readonly labels: SyncLabelReader,
  ) {}

  async exec(limit: number = DEFAULT_LIMIT): Promise<QboSyncActivity> {
    // Bound it here rather than trusting the caller: this is reached from a router whose input is
    // client-supplied, and an unbounded limit is an unbounded query.
    const capped = Math.min(Math.max(1, Math.trunc(limit) || DEFAULT_LIMIT), MAX_LIMIT);
    const entries = await this.syncLog.recent(capped);
    if (entries.length === 0) return { rows: [], retryableCount: 0 };

    // One lookup per entity type rather than one per row.
    const byType = new Map<string, string[]>();
    for (const e of entries) {
      const ids = byType.get(e.entityType);
      if (ids) ids.push(e.malletId);
      else byType.set(e.entityType, [e.malletId]);
    }
    const resolved = new Map<string, ReadonlyMap<string, string>>();
    await Promise.all(
      [...byType].map(async ([type, ids]) => {
        resolved.set(type, await this.labels.labelsFor(type, ids));
      }),
    );

    const rows = entries.map((e): QboSyncActivityRow => {
      const problem = explainSyncProblem(e.status, e.errorCode);
      return {
        entityType: e.entityType,
        malletId: e.malletId,
        // A record deleted since the attempt keeps its row — hiding a failure because its subject
        // is gone is exactly how hours go missing unnoticed.
        label: resolved.get(e.entityType)?.get(e.malletId) ?? "(no longer in Mallet)",
        status: e.status,
        qboId: e.qboId,
        problem,
        detail: e.errorMessage,
        attemptedAt: e.attemptedAt,
      };
    });

    return { rows, retryableCount: rows.filter((r) => r.problem?.retryable === true).length };
  }
}
