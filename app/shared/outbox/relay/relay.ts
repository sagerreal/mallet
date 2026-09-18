import { sql } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import type { JsonValue } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { OutboxEvent, OutboxHandler, OutboxHandlerMap } from "./handler";
import { dispositionFor, type Disposition } from "./disposition";
import { BATCH_SIZE, MAX_ATTEMPTS } from "./relay-config";

export interface RelaySummary {
  claimed: number;
  published: number; // delivered ok, or terminal (non-retryable) — either way, stops re-claiming
  drainedNoOp: number; // no handler registered for the event
  failed: number; // retryable failure/throw — left unpublished, attempts++ for the next tick
  poisoned: number; // of failed, those that just hit the attempts cap (a dead-letter now)
  raced: number; // a mark no-op'd because a concurrent tick already published the row
  markErrors: number; // a mark write itself threw (owner-conn blip); row left as-is for the next tick
  tookMs: number;
}

export interface RunRelayOptions {
  readonly batch?: number;
  readonly maxAttempts?: number;
}

interface ClaimedRow {
  id: string;
  seq: string; // bigint over raw SQL comes back as a string
  org_id: string;
  event_name: string;
  payload: Record<string, JsonValue>;
  occurred_at: Date;
  attempts: number; // the CURRENT failure count (attempts are incremented on failure, not on claim)
}

// Run a handler under its tenant tx and classify the outcome (never throws — a handler throw becomes
// a retryable "unhandled" failure). Kept separate from the mark step so a mark-write failure below is
// never misattributed as a handler throw. The pure decision lives in dispositionFor.
const classifyDispatch = async (event: OutboxEvent, handler: OutboxHandler): Promise<Disposition> => {
  try {
    const result = await withTenant(event.orgId, (tx) => handler.handle(event, { tx, orgId: event.orgId }));
    return dispositionFor(result);
  } catch (error) {
    logger.error(
      { outboxId: event.id, event: event.name, err: error instanceof Error ? error.name : "unknown" },
      "outbox relay handler threw",
    );
    return { mark: "fail", lastError: "unhandled" };
  }
};

// One relay tick: CLAIM the oldest unpublished rows (owner conn, BYPASSRLS), DISPATCH each under
// withTenant(org_id) to its handler, MARK the outcome. The three phases are SEPARATE transactions —
// at-least-once — so handlers must be idempotent. A single bounded pass (serverless-friendly): the
// cron re-invokes for the next batch. See ADR 0004.
//
// attempts is incremented ONLY when a dispatch actually fails (recordFailure), NOT at claim time, so
// a row that is claimed but never dispatched (a tick truncated by the function timeout, a crash
// before dispatch) is re-claimed next tick without burning its poison budget — it can never become a
// never-delivered dead-letter. (A process-crash-loop guard for a handler that repeatedly kills the
// process belongs to the deferred lease model; the pilot's only handler is an idempotent read.)
export const runOutboxRelay = async (
  handlers: OutboxHandlerMap,
  opts: RunRelayOptions = {},
): Promise<RelaySummary> => {
  const batch = opts.batch ?? BATCH_SIZE;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const startedAt = Date.now();

  // Claim the oldest unpublished rows under their poison budget. FOR UPDATE SKIP LOCKED so concurrent
  // ticks take disjoint sets while locked; ORDER BY seq (monotonic), not the tx-constant created_at.
  const claimed = (await ownerDb.execute(sql`
    select id, seq, org_id, event_name, payload, occurred_at, attempts
    from outbox
    where published_at is null and attempts < ${maxAttempts}
    order by seq asc
    limit ${batch}
    for update skip locked
  `)) as unknown as ClaimedRow[];

  const summary: RelaySummary = {
    claimed: claimed.length,
    published: 0,
    drainedNoOp: 0,
    failed: 0,
    poisoned: 0,
    raced: 0,
    markErrors: 0,
    tookMs: 0,
  };

  for (const row of claimed) {
    const event: OutboxEvent = {
      id: row.id,
      seq: Number(row.seq),
      orgId: asOrgId(row.org_id),
      name: row.event_name,
      payload: row.payload,
      occurredAt: row.occurred_at,
    };

    // Guard the whole per-row body so a mark-write blip (owner-conn drop / statement timeout) on ONE
    // row cannot abort the batch and strand the rest of the already-claimed rows.
    try {
      const handler = handlers.get(event.name);
      if (!handler) {
        if ((await markPublished(event.id, null)) > 0) summary.drainedNoOp += 1;
        else summary.raced += 1;
        continue;
      }

      const disposition = await classifyDispatch(event, handler);
      if (disposition.mark === "publish") {
        if ((await markPublished(event.id, disposition.lastError)) > 0) summary.published += 1;
        else summary.raced += 1;
      } else if ((await recordFailure(event.id, disposition.lastError)) > 0) {
        summary.failed += 1;
        if (row.attempts + 1 >= maxAttempts) summary.poisoned += 1; // this failure hit the cap
      } else {
        summary.raced += 1; // a concurrent tick already published it
      }
    } catch (markError) {
      // A mark write threw. The row is unchanged (published_at still null) so it is re-claimed next
      // tick (dispatch is idempotent). Do NOT abort the batch and do NOT mislabel it as a handler
      // failure — this is a distinct, logged mark error.
      logger.error(
        { outboxId: event.id, err: markError instanceof Error ? markError.name : "unknown" },
        "outbox relay mark write failed; row left for the next tick",
      );
      summary.markErrors += 1;
    }
  }

  summary.tookMs = Date.now() - startedAt;
  logger.info({ ...summary }, "outbox relay tick");
  return summary;
};

// Returns the number of rows affected. The `published_at is null` guard makes a concurrent tick's
// duplicate mark a 0-row no-op (never overwrites the winner) — the caller treats 0 as "raced".
const markPublished = async (id: string, lastError: string | null): Promise<number> =>
  affected(await ownerDb.execute(sql`
    update outbox set published_at = now(), last_error = ${lastError} where id = ${id} and published_at is null
  `));

// Records a retryable failure: increments attempts (the poison budget) and stamps a safe last_error.
// Only advances the budget for a row that was actually dispatched-and-failed this tick.
const recordFailure = async (id: string, lastError: string): Promise<number> =>
  affected(await ownerDb.execute(sql`
    update outbox set attempts = attempts + 1, last_error = ${lastError} where id = ${id} and published_at is null
  `));

const affected = (result: unknown): number => (result as { count?: number }).count ?? 0;
