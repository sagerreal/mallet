import { sql } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";

/**
 * modules/agent-tasks/infra/claim-due-tasks.ts
 * The one cross-tenant statement in the AI employee feature, and the only place within
 * `modules/agent-tasks` that touches `ownerDb`. It is NOT the owner connection's second caller
 * overall — there are eleven, inventoried in ADR 0008 §2 (the outbox relay plus a set of
 * webhook/public-token tenant resolvers, one of which both reads and writes tenant content). The
 * narrow-column rule below is this statement's own contract, not a property of that connection.
 *
 * This is deliberately NOT a repository method. `AgentTaskRepository` is constructed with a
 * transaction already scoped to one org (`modules/agent-tasks/domain/agent-task-repository.ts`)
 * precisely so no method on it can express "across all orgs" — that is the whole point of the
 * port, and it must not learn how. A scheduler-driven runner needs exactly that cross-tenant
 * read, so it lives here, over the owner (BYPASSRLS) connection, outside the repository pattern —
 * the same shape as the outbox relay's claim.
 *
 * ADR 0008 (amending ADR 0003 §2, which names the owner connection the single sanctioned non-RLS
 * path restricted to the outbox's bookkeeping) names `agent_tasks` the second table the BYPASSRLS
 * connection may touch, and restricts it to the queue columns: this statement reads and writes only
 * `(id, org_id, status, deleted_at, next_action_at, locked_until, lease_id, attempts)`.
 * It must NEVER read `title` or the conversation — those are tenant content, and are read inside
 * `withTenant` once the org is known. Likewise the `RETURNING` list is `id, org_id, attempts` and
 * nothing else: a `RETURNING *` here would pull title and conversation content across an
 * RLS-bypassing connection.
 *
 * A LEASE, not a claim. The outbox relay lets two overlapping ticks both claim and dispatch the
 * same row, which is safe there because its handlers are idempotent. An agent turn calls an LLM and
 * sends texts; a duplicated wake sends the customer two messages, which is not recoverable after
 * the fact. So this stamps `lease_id` and `locked_until` in the SAME statement that selects the
 * rows — the update, not a later one, is what makes exactly one worker the owner. `lease_id` is the
 * fencing token every later write (save, releaseLease) carries, so a worker whose lease already
 * expired can never win a race against whoever reclaimed the row.
 *
 * THE BATCH BOUND REQUIRES THE CTE. DO NOT REWRITE THIS AS
 * `update ... where id in (select ... limit n for update skip locked)`.
 * That form silently ignores the bound: measured against the live DB, `limit 2` over 6 due rows
 * leased all 6, and over 20 due rows leased all 20 — reproducibly, with raw postgres.js as well as
 * drizzle, inside an explicit transaction and in autocommit alike. The sub-SELECT on its own
 * correctly returns 2 every time; it is the `IN (...)` that breaks it. The planner runs that
 * sub-SELECT as a SubPlan re-executed once per candidate outer row, and because `SKIP LOCKED`
 * yields a DIFFERENT set on each execution, nearly every row finds itself in some execution's
 * result and matches. The `LIMIT` is honoured — it just bounds each execution rather than the
 * update. A CTE containing `FOR UPDATE` is never inlined by Postgres, so it is materialised and
 * evaluated exactly once, which is what actually enforces the bound. Verified: 36 consecutive
 * trials, 6 and 20 candidates, in-transaction and autocommit, all claimed exactly 2.
 *
 * No explicit transaction. A single statement is already atomic, and an earlier version of this
 * file wrapped the statement in `ownerDb.transaction()` claiming that fixed an over-claim caused by
 * the pooled client. That claim was wrong in both directions: the wrapper does not fix the
 * over-claim (it made it reproduce 30/30 rather than intermittently, which is how the real cause
 * above was finally isolated), and the pool was never involved.
 *
 * `now` MUST be bound as `now.toISOString()` cast `::timestamptz`, never as the raw `Date` —
 * postgres.js (`prepare: false`, see `shared/db/keyset.ts`) cannot bind a JS `Date` as a query
 * parameter: passing one throws `TypeError: The "string" argument must be of type string...
 * Received an instance of Date` and the claim never runs. Every comparison against "now" below
 * goes through the ISO-string local, not `opts.now` directly.
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

  const rows = (await ownerDb.execute(sql`
    with due as (
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
    update agent_tasks t set
      lease_id = ${opts.leaseId},
      locked_until = ${now}::timestamptz + (${leaseMinutes} * interval '1 minute')
    from due
    where t.id = due.id
    returning t.id, t.org_id, t.attempts
  `)) as unknown as ClaimedRow[];

  return rows.map((r) => ({ id: r.id, orgId: r.org_id, attempts: r.attempts }));
};
