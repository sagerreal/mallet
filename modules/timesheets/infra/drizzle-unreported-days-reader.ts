import { sql } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, UserId } from "@mallet/shared/types";

/**
 * modules/timesheets/infra/drizzle-unreported-days-reader.ts
 * Days somebody evidently worked and sent in no hours.
 *
 * A MISSING DAY IS A MONEY BUG, and it is the only timesheet gap worth interrupting anyone about.
 * A hole *inside* a day is usually correct — the man got off the clock — and flagging correct
 * behaviour is how people learn to ignore the flag. But visits stamped to somebody on a day with
 * no time entry at all is near-conclusive: they were on jobs, and their paycheck is short.
 *
 * The window it suggests is FIRST-to-LAST activity, and it is only ever a SUGGESTION. This never
 * writes hours; inventing a day on a worker's behalf is how a timesheet stops being their own
 * statement of what they did.
 *
 * Ordinary shape, and why the query has to be careful: a shop where nobody taps Arrived produces
 * no rows here at all, which is correct — there is no evidence to reason from, and guessing from
 * the schedule alone would flag every technician who took a day off.
 */

export interface UnreportedDay {
  readonly userId: string;
  /** YYYY-MM-DD. */
  readonly date: string;
  /** Visits stamped to them that day. */
  readonly visits: number;
  /**
   * Earliest activity as an ISO INSTANT. Null when only a date is known.
   *
   * WAS `to_char(..., 'HH24:MI')`, which renders in the DATABASE session's timezone — UTC. So this
   * card told a California technician he had worked "first 4:05a, last 4:56a" on a day he worked
   * nine to five, and the Add button offered to WRITE those hours. Wrong hours in payroll, not a
   * cosmetic slip. The instant is the fact; the device renders the wall clock.
   */
  readonly firstStampAt: string | null;
  readonly lastStampAt: string | null;
}

/**
 * The day a visit's activity belongs to — its booked day, else the day it was finished.
 *
 * Written against the query's own alias rather than interpolating the drizzle column objects.
 * Those render as `"job_visits"."scheduled_date"`, which does not resolve inside a statement whose
 * FROM clause aliases the table `v` — Postgres rejects the whole query, the tRPC call fails, and
 * the surface renders an EMPTY exceptions strip that is indistinguishable from a clean week. The
 * integration test is what caught it; the browser could not.
 */
const VISIT_DAY = `coalesce(v.scheduled_date, v.completed_at::date)`;

export class DrizzleUnreportedDaysReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  /**
   * Days in [from, to] where a person has visit activity and no time entry at all.
   *
   * `onlyUserId` scopes it to one person — what the technician's own screen asks. Omitted, it
   * answers for the whole crew, which is what the office approval strip needs.
   */
  async find(from: string, to: string, onlyUserId?: UserId): Promise<UnreportedDay[]> {
    const rows = await this.tx.execute<{
      user_id: string;
      day: string;
      visits: string;
      first_at: Date | null;
      last_at: Date | null;
    }>(sql`
      SELECT
        v.assignee_user_id                                   AS user_id,
        ${sql.raw(VISIT_DAY)}                                          AS day,
        count(*)                                             AS visits,
        min(coalesce(v.enroute_at, v.started_at))             AS first_at,
        max(coalesce(v.completed_at, v.started_at))           AS last_at
      FROM job_visits v
      WHERE v.org_id = ${this.orgId}
        AND v.assignee_user_id IS NOT NULL
        AND v.deleted_at IS NULL
        AND v.status <> 'canceled'
        AND ${sql.raw(VISIT_DAY)} BETWEEN ${from} AND ${to}
        ${onlyUserId ? sql`AND v.assignee_user_id = ${onlyUserId}` : sql``}
        -- Evidence of work, not merely a booking. A visit still sitting 'pending' on a future day
        -- is a plan; flagging its owner for not having submitted hours yet would fire on every
        -- technician every morning.
        AND (v.started_at IS NOT NULL OR v.completed_at IS NOT NULL)
        -- ANY time entry on that day clears it. Deliberately not "enough hours": how many hours a
        -- day should hold is the shop's business, and this only claims the day is unreported.
        AND NOT EXISTS (
          SELECT 1 FROM time_entries t
          WHERE t.org_id = v.org_id
            AND t.tech_user_id = v.assignee_user_id
            AND t.work_date = ${sql.raw(VISIT_DAY)}
            AND t.deleted_at IS NULL
        )
      GROUP BY v.assignee_user_id, ${sql.raw(VISIT_DAY)}
      ORDER BY ${sql.raw(VISIT_DAY)} ASC, v.assignee_user_id ASC
    `);

    return rows.map((r) => ({
      userId: r.user_id,
      date: r.day,
      visits: Number(r.visits),
      firstStampAt: r.first_at ? new Date(r.first_at).toISOString() : null,
      lastStampAt: r.last_at ? new Date(r.last_at).toISOString() : null,
    }));
  }
}
