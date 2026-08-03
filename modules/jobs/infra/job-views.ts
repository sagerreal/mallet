import { and, eq, exists, gt, gte, isNull, lte, ne, not, notInArray, or, sql, type SQL } from "drizzle-orm";
import { jobs, jobVisits, jobLines, invoices } from "@mallet/shared/db/schema";
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
 * The auto-archive window (7 days). The only definition — the client-side band math that once
 * carried a twin of this constant was deleted with the browser-derived lifecycle bands.
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

/**
 * DATED — the visit has landed on a day. NOT the same question as placed; see below.
 *
 * Kept as its own named predicate rather than folded into PLACED because one consumer genuinely
 * asks the date-only question: the dispatch board's window (visitsBetween) loads "what falls in
 * these days", crewed or not.
 */
const DATED = sql`${jobVisits.scheduledDate} IS NOT NULL`;

/** ASSIGNED — somebody is going. The board has no lane to draw a visit without this. */
const ASSIGNED = sql`${jobVisits.assigneeUserId} IS NOT NULL`;

/**
 * PLACED — a day AND a crew. The SQL twin of the client's `isVisitPlaced`
 * (lib/store/visit-placement.ts), and the rule the whole Jobs screen splits on.
 *
 * NO TECH MEANS NOT PLACED. This used to be the date alone, and the two rules disagreeing is how
 * work went missing: the dispatch board draws a visit in its ASSIGNEE'S lane, so a visit with a
 * day and a time but nobody on it has no row to occupy and renders nowhere — while the server,
 * seeing a date, called it placed and kept it OUT of "Needs a slot". The job was invisible in both
 * of the two places it should have appeared, and the only way to find it was to already know it
 * existed. Reachable through `createVisit` (assignee optional) and `patchVisitSchedule`
 * (unassigning a crew from a dated visit); three such rows were live when this was fixed.
 *
 * (The client rule also requires a start time. That one clause still differs — documented at the
 * client twin, zero rows in the live database.)
 */
export const PLACED = and(DATED, ASSIGNED) as SQL;

/**
 * Jobs with a live visit landing in [from, to], inclusive — the dispatch board's window.
 *
 * Not one of the named views: those are relative to today, and the board navigates to any day or
 * week. It used to filter the loaded jobs collection, which is capped at the hydrator's page size,
 * so any date past that window drew an empty board that looked exactly like a day with nothing on
 * it. Exported for the repository's filter.
 *
 * DATE-ONLY ON PURPOSE — this is `DATED`, not `PLACED`. The window's question is "what falls in
 * these days", and its answer is MERGED into the shared jobs collection a dozen surfaces read
 * (see useScheduleWindow); narrowing it to crewed visits would drop half-planned work out of the
 * store for everyone, to hide a card the board was never going to draw anyway. Half-planned work
 * is surfaced through "Needs a slot" instead, which is where it can be acted on.
 */
export const visitsBetween = (tx: TenantTx, from: string, to: string): SQL =>
  visitWhere(tx, and(gte(jobVisits.scheduledDate, from), lte(jobVisits.scheduledDate, to)) as SQL);

export interface ViewParams {
  /** The client's LOCAL date, YYYY-MM-DD. See the note above on why this is not server-derived. */
  readonly today: string;
}

/** A live invoice minted from this job — the "it was billed" fact the finished bands split on. */
const invoiceExists = (tx: TenantTx): SQL =>
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
  );

/**
 * An UNPRICED ESTIMATE — a scoping visit with nothing to bill. The SQL twin of the client's
 * isUnpricedEstimate (tech-job-modal/helpers.ts); the two must agree or the list shows a band
 * the modal refuses to act on.
 *
 * Priced-ness needs BOTH checks: `total_cents` is a creation-time snapshot from the source
 * estimate that the on-site sign path never updates — a quote signed in the field writes priced
 * `job_lines` rows instead. Either one makes the job real money and keeps it billable.
 */
const unpricedEstimate = (tx: TenantTx): SQL =>
  and(
    eq(jobs.svc, "estimate"),
    eq(jobs.totalCents, 0),
    not(
      exists(
        tx
          .select({ one: sql`1` })
          .from(jobLines)
          .where(
            and(
              eq(jobLines.orgId, jobs.orgId),
              eq(jobLines.jobId, jobs.id),
              isNull(jobLines.deletedAt),
              sql`${jobLines.quantity} * ${jobLines.rateCents} > 0`,
            ),
          ),
      ),
    ),
  ) as SQL;

/**
 * Nothing left to bill on this finished job: it was invoiced, OR it is an unpriced estimate
 * (the deliverable is a quote, not an invoice). The complement of needsInvoice among complete
 * jobs — keeping the three finished bands a partition is what keeps the counts honest.
 */
const settled = (tx: TenantTx): SQL => or(invoiceExists(tx), unpricedEstimate(tx)) as SQL;

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

  // EVERY dispatch band reads PLACED, not the date. `today` and `upcoming` used to test the date
  // alone, which was survivable while `needsSlot` did too — the moment needsSlot started meaning
  // "no crew on it either", a dated, crewless visit would have satisfied BOTH bands and broken the
  // mutual exclusivity the counts depend on. They also mean the right thing this way round: a day
  // with nobody assigned to it is not work that is going out today.
  const onToday = visitWhere(tx, and(PLACED, eq(jobVisits.scheduledDate, p.today)) as SQL);
  const byWeekEnd = visitWhere(tx, and(PLACED, lte(jobVisits.scheduledDate, weekEnd)) as SQL);

  switch (view) {
    case "needsSlot":
      // Open, and nothing has been put on a day WITH A CREW yet — sold work going nowhere.
      return and(open, sql`NOT ${visitWhere(tx, PLACED)}`) as SQL;
    case "today":
      return and(open, onToday) as SQL;
    case "week":
      // Anything due on or before today+7 that is not already in Today. Includes overdue.
      return and(open, byWeekEnd, sql`NOT ${onToday}`) as SQL;
    case "upcoming":
      return and(
        open,
        visitWhere(tx, and(PLACED, gt(jobVisits.scheduledDate, weekEnd)) as SQL),
        sql`NOT ${byWeekEnd}`,
      ) as SQL;
    case "needsInvoice":
      // Finished work nobody has billed — money on the floor. Unpriced estimates are NOT money
      // on the floor: a scoping visit's deliverable is a quote, so it lands in done/archived.
      return and(
        eq(jobs.status, "complete"),
        not(invoiceExists(tx)),
        not(unpricedEstimate(tx)),
      ) as SQL;
    case "archived":
      // Auto-archived: finished, settled, and old enough to have fallen off the working list.
      // The client derived this from the loaded collection; in SQL it is a date predicate.
      return and(
        eq(jobs.status, "complete"),
        sql`${jobs.completedAt} < (${p.today}::date - interval '${sql.raw(String(ARCHIVE_AFTER_DAYS))} days')`,
        settled(tx),
      ) as SQL;
    case "done":
    default:
      // Explicitly NOT the archived ones, or a finished job older than the cutoff is counted in
      // both — the mutual-exclusivity property everything else on this screen depends on.
      return and(
        eq(jobs.status, "complete"),
        sql`(${jobs.completedAt} IS NULL OR ${jobs.completedAt} >= (${p.today}::date - interval '${sql.raw(String(ARCHIVE_AFTER_DAYS))} days'))`,
        settled(tx),
      ) as SQL;
  }
};
