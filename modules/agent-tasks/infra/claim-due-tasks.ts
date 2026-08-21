import { sql } from "drizzle-orm";
import { ownerDb } from "@mallet/shared/db/owner-client";

/**
 * modules/agent-tasks/infra/claim-due-tasks.ts
 * The one cross-tenant statement in the AI employee, and the one place `ownerDb` is touched
 * outside `shared/outbox/relay/relay.ts`.
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
 * reads and writes only `(id, org_id, status, next_action_at, locked_until, lease_id, attempts)`.
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
 * `now` is bound as `now.toISOString()` cast `::timestamptz`, never as the raw `Date`.
 * `shared/db/keyset.ts` documents why: postgres.js (`prepare: false`) cannot bind a JS `Date`
 * as a query parameter here — it throws `TypeError: The "string" argument must be of type
 * string... Received an instance of Date`. Confirmed the same failure reproduces for this
 * statement's scalar comparisons, not just keyset's row-value tuples, while wiring up the
 * integration test below.
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

export const claimDueTasks = async (opts: {
  readonly batch: number;
  readonly leaseMinutes: number;
  readonly leaseId: string;
  readonly now: Date;
}): Promise<readonly ClaimedTask[]> => {
  const now = opts.now.toISOString();
  const rows = (await ownerDb.execute(sql`
    update agent_tasks set
      lease_id = ${opts.leaseId},
      locked_until = ${now}::timestamptz + (${opts.leaseMinutes} * interval '1 minute')
    where id in (
      select id from agent_tasks
      where status = 'working'
        and deleted_at is null
        and next_action_at is not null
        and next_action_at <= ${now}::timestamptz
        and (locked_until is null or locked_until < ${now}::timestamptz)
      order by next_action_at asc
      limit ${opts.batch}
      for update skip locked
    )
    returning id, org_id, attempts
  `)) as unknown as ClaimedRow[];

  return rows.map((r) => ({ id: r.id, orgId: r.org_id, attempts: r.attempts }));
};
