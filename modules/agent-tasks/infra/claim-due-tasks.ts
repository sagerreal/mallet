import { sql } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";

/**
 * modules/agent-tasks/infra/claim-due-tasks.ts
 * The one cross-tenant statement in the AI employee feature, and the only place within
 * `modules/agent-tasks` that touches `ownerDb` (the outbox relay is a separate, unrelated
 * caller of the same owner connection elsewhere in the codebase).
 *
 * This is deliberately NOT a repository method. `AgentTaskRepository` is constructed with a
 * transaction already scoped to one org (`modules/agent-tasks/domain/agent-task-repository.ts`)
 * precisely so no method on it can express "across all orgs" — that is the whole point of the
 * port, and it must not learn how. A scheduler-driven runner needs exactly that cross-tenant
 * read, so it lives here, over the owner (BYPASSRLS) connection, outside the repository pattern —
 * the same shape as the outbox relay's claim.
 *
 * A later ADR amending ADR 0003 §2 (that section currently names the owner connection the single
 * sanctioned non-RLS path, restricted to the outbox's bookkeeping) names `agent_tasks` the second
 * table the BYPASSRLS connection may touch, and restricts it to the queue columns: this statement
 * reads and writes only
 * `(id, org_id, status, deleted_at, next_action_at, locked_until, lease_id, attempts)`.
 * It must NEVER read `title` or the conversation — those are tenant content, and are read inside
 * `withTenant` once the org is known. (Numbered "ADR 0006" in the original plan doc, but 0006 and
 * 0007 have since shipped for unrelated MCP work — the amendment lands as ADR 0008.)
 *
 * A LEASE, not a claim. The outbox relay's `for update skip locked` runs via `ownerDb.execute()`
 * OUTSIDE a transaction, so the row lock releases at statement auto-commit, before dispatch — two
 * overlapping ticks can therefore both claim and dispatch the same row. That is safe for the
 * outbox because handlers are idempotent. An agent turn calls an LLM and sends texts; a
 * duplicated wake sends the customer two messages, which is not recoverable after the fact. So
 * this claim is a SINGLE atomic `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)` that
 * stamps `lease_id` and `locked_until` in the SAME statement — the update, not a later one, is
 * what makes exactly one worker the owner. `lease_id` is the fencing token every later write
 * (save, releaseLease) carries, so a worker whose lease already expired can never win a race
 * against whoever reclaimed the row.
 *
 * Returns ids only. `SELECT *` (or a `RETURNING *`) here would pull `title` and conversation
 * content across an RLS-bypassing connection — this statement's `RETURNING` is scoped to
 * `id, org_id, attempts` and nothing else, on purpose.
 *
 * `now` MUST be bound as `now.toISOString()` cast `::timestamptz`, never as the raw `Date` —
 * postgres.js (`prepare: false`, see `shared/db/keyset.ts`) cannot bind a JS `Date` as a query
 * parameter: passing one throws `TypeError: The "string" argument must be of type string...
 * Received an instance of Date` and the claim never runs. Every comparison against "now" below
 * goes through the ISO-string local, not `opts.now` directly.
 *
 * WRAPPED IN `ownerDb.transaction(...)` FOR A REAL REASON, NOT STYLE. `ownerQueryClient` is a
 * pooled client (`max: 2`). Live-DB testing surfaced a driver/pool-level defect: the very first
 * statement(s) issued against a freshly constructed pooled client can — non-deterministically —
 * have this statement's `RETURNING` come back with MORE rows than its own `LIMIT`, even with
 * `LIMIT` bound as a literal (not a parameter) and with no repeated parameters at all. Reproduced
 * with `max: 2` (both via the real `ownerDb` singleton and a from-scratch client with identical
 * options); reproduced 0/20 times with `max: 1`; reproduced 0/15 times once the SAME statement was
 * wrapped in `ownerDb.transaction(...)`, which pins the statement to one dedicated connection
 * checked out of the pool for the transaction's duration instead of letting the pool arbitrate.
 * The wrap changes nothing about atomicity (a lone statement is already one atomic unit whether or
 * not it sits inside an explicit BEGIN/COMMIT) and nothing about the lease timing described above
 * — it only removes the pool as a variable. Do not remove it as a "simplification"; removing it
 * reopens a batch-cap violation that is silent in the caller (no error, no exception — just more
 * leased rows than `batch` asked for).
 *
 * `batch` and `leaseMinutes` are validated integers, then inlined via `sql.raw`, never bound as
 * ordinary parameters. They are structural SQL (a `LIMIT` count and an `interval` multiplier), not
 * tenant data, so they can't carry injection once validated — and a caller passing a non-integer,
 * zero, negative, or absurd value is a programmer error that must throw immediately rather than
 * silently no-op or run away.
 */
export interface ClaimedTask {
  readonly id: string;
  readonly orgId: string;
  readonly attempts: number;
}

interface ClaimedRow {
  id: string;
  org_id: string;
  attempts: number;
}

const MAX_BATCH = 1000;
const MAX_LEASE_MINUTES = 24 * 60;

const assertBoundedInt = (value: number, label: string, max: number): void => {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`claimDueTasks: ${label} must be an integer in [1, ${max}], got ${value}`);
  }
};

export const claimDueTasks = async (opts: {
  readonly batch: number;
  readonly leaseMinutes: number;
  readonly leaseId: string;
  readonly now: Date;
}): Promise<readonly ClaimedTask[]> => {
  assertBoundedInt(opts.batch, "batch", MAX_BATCH);
  assertBoundedInt(opts.leaseMinutes, "leaseMinutes", MAX_LEASE_MINUTES);

  const now = opts.now.toISOString();
  const batch = sql.raw(String(opts.batch));
  const leaseMinutes = sql.raw(String(opts.leaseMinutes));

  const rows = (await ownerDb.transaction(async (tx) =>
    tx.execute(sql`
      update agent_tasks set
        lease_id = ${opts.leaseId},
        locked_until = ${now}::timestamptz + (${leaseMinutes} * interval '1 minute')
      where id in (
        select id from agent_tasks
        where status = 'working'
          and deleted_at is null
          and next_action_at is not null
          and next_action_at <= ${now}::timestamptz
          and (locked_until is null or locked_until < ${now}::timestamptz)
        order by next_action_at asc
        limit ${batch}
        for update skip locked
      )
      returning id, org_id, attempts
    `),
  )) as unknown as ClaimedRow[];

  return rows.map((r) => ({ id: r.id, orgId: r.org_id, attempts: r.attempts }));
};
