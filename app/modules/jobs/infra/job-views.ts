import { and, eq, exists, gt, gte, isNull, lt, lte, ne, not, notInArray, or, sql, type SQL } from "drizzle-orm";
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
export const JOB_VIEWS = ["needsSlot", "late", "today", "week", "upcoming", "needsInvoice", "done", "archived"] as const;
export type JobView = (typeof JOB_VIEWS)[number];

/** Labels, matching the bands the screen already shows. */
export const JOB_VIEW_LABELS: Record<JobView, string> = {
  needsSlot: "Needs a slot",
  late: "Late",
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
 * OUTSTANDING — placed, and not finished yet. What every dispatch band actually wants to know.
 *
 * PLACED alone answers "has a trip ever been booked", and a job whose first trip is DONE answers
 * yes forever. That was survivable while a second visit was something only the office created;
 * once a technician can book a return from the field it becomes the normal shape, and the bands
 * read it wrong in both directions: the job stays out of "Needs a slot" (a placed visit exists)
 * and falls into "This week" (that visit is dated in the past, and week includes overdue). The
 * one job on the screen that genuinely needs a date is filed as work already going out.
 *
 * A finished visit is history. The bands are asking about the trip that has not happened.
 */
const OUTSTANDING = and(PLACED, ne(jobVisits.status, "complete")) as SQL;

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
    // kind is the source of truth since 0133 — svc carries only the trade label now, which is
    // exactly why a voice-booked estimate (kind='estimate', svc='Water heater repair') used to
    // fall through this predicate and land in Money as billable work.
    eq(jobs.kind, "estimate"),
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
 * Overdue work has its own band (`late`) as of 2026-08-13. It used to land in `week`, matching
 * today-derive's `daysOut(...) <= 7`, which a negative number satisfies — preserved at the time
 * because changing where overdue work appears is a product decision rather than a side effect of
 * moving the query. That decision has now been made: see `onLate` below.
 *
 * DISPLAY ORDER IS NOT PREDICATE ORDER. The chips read
 * `Needs a slot · Late · Today · This week · Upcoming · Done, not billed · Done` — the two stuck
 * states lead, and the time run stays contiguous because a dispatcher reads it as a sequence.
 * Exclusivity resolves in a different order: needsSlot → today → late → week → upcoming →
 * needsInvoice → done → archived.
 */
export const viewCondition = (view: JobView, tx: TenantTx, p: ViewParams): SQL => {
  const open = notInArray(jobs.status, [...TERMINAL]);
  const weekEnd = sql`(${p.today}::date + interval '7 days')`;

  // EVERY dispatch band reads PLACED, not the date. `today` and `upcoming` used to test the date
  // alone, which was survivable while `needsSlot` did too — the moment needsSlot started meaning
  // "no crew on it either", a dated, crewless visit would have satisfied BOTH bands and broken the
  // mutual exclusivity the counts depend on. They also mean the right thing this way round: a day
  // with nobody assigned to it is not work that is going out today.
  const onToday = visitWhere(tx, and(OUTSTANDING, eq(jobVisits.scheduledDate, p.today)) as SQL);
  const byWeekEnd = visitWhere(tx, and(OUTSTANDING, lte(jobVisits.scheduledDate, weekEnd)) as SQL);
  // OVERDUE — a trip booked onto a past day that has not happened.
  //
  // This used to be swallowed by `week`: byWeekEnd is `<= today+7` with NO lower bound, so every
  // past date satisfied it. That was deliberate, and the comment above said moving it was a
  // product decision rather than a side effect of the query. This is that decision — overdue work
  // is the most actionable state on the screen and it was scattered through the week band with no
  // way to ask for it.
  //
  // OUTSTANDING, not merely dated: a finished visit is history, so a job whose first trip is done
  // must not report late forever for work that already happened. And PLACED means a day AND a
  // crew — a past day with nobody on it is a SLOT problem, and calling it late would name the
  // wrong missing thing.
  const onLate = visitWhere(tx, and(OUTSTANDING, lt(jobVisits.scheduledDate, p.today)) as SQL);

  switch (view) {
    case "needsSlot":
      // Open, and no UNFINISHED trip is on a day with a crew — sold work going nowhere. Covers
      // both the job nobody has scheduled yet and the job whose remaining visit is a follow-up
      // booked from the field with no date on it.
      return and(open, sql`NOT ${visitWhere(tx, OUTSTANDING)}`) as SQL;
    case "late":
      // TODAY OUTRANKS LATE. A job carrying an overdue trip AND one today belongs on today's run
      // — a day view that omits work going out today is not a day view. The overdue trip is still
      // named on the row (jobWhenLabel), so nothing is hidden by the ranking.
      return and(open, onLate, sql`NOT ${onToday}`) as SQL;
    case "today":
      return and(open, onToday) as SQL;
    case "week":
      // Anything due on or before today+7 that is neither today's nor overdue. The late exclusion
      // is load-bearing: byWeekEnd has no lower bound, so without it the same job satisfies both
      // and the counts stop summing to the book.
      return and(open, byWeekEnd, sql`NOT ${onToday}`, sql`NOT ${onLate}`) as SQL;
    case "upcoming":
      return and(
        open,
        visitWhere(tx, and(OUTSTANDING, gt(jobVisits.scheduledDate, weekEnd)) as SQL),
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
