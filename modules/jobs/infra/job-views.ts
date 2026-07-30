import { and, eq, exists, gt, isNull, lte, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { jobs, jobVisits, invoices } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";

/**
 * The scoped views on the Jobs list — the SQL twin of the lifecycle bands in today-derive.ts.
 *
 * These used to be computed in the browser by grouping the whole job collection. That works until
 * the collection is bigger than one page, at which point the groups describe the page rather than
 * the business. Moving them into SQL is what lets "Needs a slot (13)" mean thirteen jobs rather
 * than thirteen of the five hundred that happened to load.
 *
 * The labels are Owen's existing band labels, not Jobber's. Jobber's SHAPE is the pattern being
 * followed — a status filter carrying per-value counts — not its vocabulary.
 *
 * WHY THE CLIENT PASSES `today` RATHER THAN THE SERVER CALLING now().
 * There is no org timezone column. The bands are computed from the dispatcher's browser clock,
 * which for a single-location shop IS the shop's timezone — a server using UTC would push an 8pm
 * Pacific job onto tomorrow's list. Passing the client's local date preserves exactly the
 * behaviour the bands already have rather than inventing a timezone model alongside it.
 *
 * Not a security surface: the worst a forged date does is show you a different day of your own
 * jobs, which you can already see.
 */
export const JOB_VIEWS = ["needsSlot", "today", "week", "upcoming", "needsInvoice", "done", "archived"] as const;
export type JobView = (typeof JOB_VIEWS)[number];

/** Labels, matching the bands the screen already shows. */
export const JOB_VIEW_LABELS: Record<JobView, string> = {
  needsSlot: "Needs a slot",
  today: "Today",
  week: "This week",
  upcoming: "Upcoming",
  needsInvoice: "Done, not billed",
  done: "Done",
  archived: "Archived",
};

/**
 * How long a finished, billed job stays on the active list before it archives itself.
 *
 * MUST equal JOB_ARCHIVE_AFTER_DAYS in features/jobs/today-derive.ts (7). Duplicated rather than
 * imported because a domain module must not reach into features/ — an integration test asserts
 * the two agree, because a silent drift here moves jobs between Done and Archived.
 */
export const ARCHIVE_AFTER_DAYS = 7;

const TERMINAL = ["complete", "canceled"] as const;

/** An active (non-canceled, non-deleted) visit on this job, narrowed by `extra`. */
const visitWhere = (tx: TenantTx, extra: SQL): SQL =>
  exists(
    tx
      .select({ one: sql`1` })
      .from(jobVisits)
      .where(
        and(
          eq(jobVisits.orgId, jobs.orgId),
          eq(jobVisits.jobId, jobs.id),
          ne(jobVisits.status, "canceled"),
          isNull(jobVisits.deletedAt),
          extra,
        ),
      ),
  );

const PLACED = sql`${jobVisits.scheduledDate} IS NOT NULL`;

export interface ViewParams {
  /** The client's LOCAL date, YYYY-MM-DD. See the note above on why this is not server-derived. */
  readonly today: string;
}

/**
 * The predicate for one view.
 *
 * MUTUALLY EXCLUSIVE by construction, so the counts sum to the book and no job appears twice.
 * That property came free with the grouped list and is the one most easily lost in SQL: `week`
 * has to exclude today explicitly, or this afternoon's job is counted in both bands.
 *
 * Overdue work (a placed visit in the past) lands in `week`, matching today-derive: it filters on
 * `daysOut(...) <= 7`, which a negative number satisfies. Preserved deliberately — changing where
 * overdue work appears is a product decision, not a side effect of moving the query.
 */
export const viewCondition = (view: JobView, tx: TenantTx, p: ViewParams): SQL => {
  const open = notInArray(jobs.status, [...TERMINAL]);
  const weekEnd = sql`(${p.today}::date + interval '7 days')`;

  const onToday = visitWhere(tx, eq(jobVisits.scheduledDate, p.today));
  const byWeekEnd = visitWhere(tx, and(PLACED, lte(jobVisits.scheduledDate, weekEnd)) as SQL);

  switch (view) {
    case "needsSlot":
      // Open, and nothing has been put on a day yet — sold work going nowhere.
      return and(open, sql`NOT ${visitWhere(tx, PLACED)}`) as SQL;
    case "today":
      return and(open, onToday) as SQL;
    case "week":
      // Anything due on or before today+7 that is not already in Today. Includes overdue.
      return and(open, byWeekEnd, sql`NOT ${onToday}`) as SQL;
    case "upcoming":
      return and(open, visitWhere(tx, gt(jobVisits.scheduledDate, weekEnd)), sql`NOT ${byWeekEnd}`) as SQL;
    case "needsInvoice":
      // Finished work nobody has billed — money on the floor.
      return and(
        eq(jobs.status, "complete"),
        sql`NOT ${exists(
          tx
            .select({ one: sql`1` })
            .from(invoices)
            .where(
              and(
                eq(invoices.orgId, jobs.orgId),
                eq(invoices.sourceJobId, jobs.id),
                isNull(invoices.deletedAt),
              ),
            ),
        )}`,
      ) as SQL;
    case "archived":
      // Auto-archived: finished, billed, and old enough to have fallen off the working list.
      // The client derived this from the loaded collection; in SQL it is a date predicate.
      return and(
        eq(jobs.status, "complete"),
        sql`${jobs.completedAt} < (${p.today}::date - interval '${sql.raw(String(ARCHIVE_AFTER_DAYS))} days')`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(invoices)
            .where(
              and(
                eq(invoices.orgId, jobs.orgId),
                eq(invoices.sourceJobId, jobs.id),
                isNull(invoices.deletedAt),
              ),
            ),
        ),
      ) as SQL;
    case "done":
    default:
      // Explicitly NOT the archived ones, or a finished job older than the cutoff is counted in
      // both — the mutual-exclusivity property everything else on this screen depends on.
      return and(
        eq(jobs.status, "complete"),
        sql`(${jobs.completedAt} IS NULL OR ${jobs.completedAt} >= (${p.today}::date - interval '${sql.raw(String(ARCHIVE_AFTER_DAYS))} days'))`,
        exists(
          tx
            .select({ one: sql`1` })
            .from(invoices)
            .where(
              and(
                eq(invoices.orgId, jobs.orgId),
                eq(invoices.sourceJobId, jobs.id),
                isNull(invoices.deletedAt),
              ),
            ),
        ),
      ) as SQL;
  }
};
