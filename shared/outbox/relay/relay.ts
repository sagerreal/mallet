import { sql } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { withTenant } from "@mallet/shared/db/tx";
import { asOrgId } from "@mallet/shared/types";
import type { JsonValue } from "@mallet/shared/ports";
import { logger } from "@mallet/shared/observability";
import type { OutboxEvent, OutboxHandlerMap } from "./handler";
import { safeLastError } from "./last-error";
import { BATCH_SIZE, MAX_ATTEMPTS } from "./relay-config";

export interface RelaySummary {
  claimed: number;
  published: number; // delivered ok, or terminal (non-retryable) — either way, stops re-claiming
  drainedNoOp: number; // no handler registered for the event
  failed: number; // left unpublished for the next tick
  poisoned: number; // of failed, those that just hit the attempts cap (a dead-letter now)
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
  attempts: number; // post-increment
}

// One relay tick: CLAIM the oldest unpublished rows (owner conn, BYPASSRLS), DISPATCH each under
// withTenant(org_id) to its handler, MARK the outcome. The three phases are SEPARATE transactions —
// at-least-once — so handlers must be idempotent. A single bounded pass (serverless-friendly): the
// cron re-invokes for the next batch. See ADR 0004.
export const runOutboxRelay = async (
  handlers: OutboxHandlerMap,
  opts: RunRelayOptions = {},
): Promise<RelaySummary> => {
  const batch = opts.batch ?? BATCH_SIZE;
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const startedAt = Date.now();

  // Claim + increment attempts in ONE statement. FOR UPDATE SKIP LOCKED so concurrent ticks take
  // disjoint sets; attempts++ inside the claim means a handler that crashes the process still burns
  // an attempt (a persistently-poison row can't loop forever). ORDER BY seq (monotonic), not the
  // tx-constant created_at.
  const claimed = (await ownerDb.execute(sql`
    with claimed as (
      select id from outbox
      where published_at is null and attempts < ${maxAttempts}
      order by seq asc
      limit ${batch}
      for update skip locked
    )
    update outbox o set attempts = o.attempts + 1
    from claimed c where o.id = c.id
    returning o.id, o.seq, o.org_id, o.event_name, o.payload, o.occurred_at, o.attempts
  `)) as unknown as ClaimedRow[];

  const summary: RelaySummary = {
    claimed: claimed.length,
    published: 0,
    drainedNoOp: 0,
    failed: 0,
    poisoned: 0,
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

    const handler = handlers.get(event.name);
    if (!handler) {
      await markPublished(event.id, null);
      summary.drainedNoOp += 1;
      continue;
    }

    try {
      const result = await withTenant(event.orgId, (tx) => handler.handle(event, { tx, orgId: event.orgId }));
      if (result.ok) {
        await markPublished(event.id, null);
        summary.published += 1;
      } else if (result.error.kind === "external_service" && result.error.retryable) {
        // Transient infra failure — leave unpublished so the next tick retries.
        await recordFailure(event.id, safeLastError({ kind: "apperror", error: result.error }));
        summary.failed += 1;
        if (row.attempts >= maxAttempts) summary.poisoned += 1;
      } else {
        // A bad/un-processable event (validation/not_found/conflict/non-retryable). Publish so it
        // stops re-claiming, recording a safe reason — retrying would fail identically.
        await markPublished(event.id, safeLastError({ kind: "apperror", error: result.error }));
        summary.published += 1;
      }
    } catch (error) {
      logger.error(
        { outboxId: event.id, event: event.name, attempt: row.attempts, err: error instanceof Error ? error.name : "unknown" },
        "outbox relay handler threw",
      );
      await recordFailure(event.id, "unhandled");
      summary.failed += 1;
      if (row.attempts >= maxAttempts) summary.poisoned += 1;
    }
  }

  summary.tookMs = Date.now() - startedAt;
  logger.info({ ...summary }, "outbox relay tick");
  return summary;
};

const markPublished = (id: string, lastError: string | null): Promise<unknown> =>
  ownerDb.execute(
    sql`update outbox set published_at = now(), last_error = ${lastError} where id = ${id} and published_at is null`,
  );

const recordFailure = (id: string, lastError: string): Promise<unknown> =>
  ownerDb.execute(sql`update outbox set last_error = ${lastError} where id = ${id} and published_at is null`);
