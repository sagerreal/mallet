import { and, eq, exists, isNull, ne, sql, type SQL } from "drizzle-orm";
import { leads, estimates, jobVisits, jobs } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";

/**
 * The Pipeline board's columns, in SQL — the twin of deriveIntake/deriveRail in features/pipeline.
 *
 * The board derived its columns in the browser from three collections at once (leads, estimates,
 * jobs), so it could only ever classify the rows that had loaded. On a 606-customer book its first
 * column read "New leads 500" — the hydrator's page size wearing the label of a business fact.
 *
 * `intake` is the interesting one: a lead nobody has papered yet. Not "stage = new" — a lead can
 * sit at stage new and already have a quote out, in which case it belongs in Quoting. The board
 * asks "has anything happened to this customer", which is an EXISTS against estimates and visits,
 * and that is why the column cannot be a simple status filter.
 */
export const LEAD_VIEWS = ["intake", "quoting", "out", "won"] as const;
export type LeadView = (typeof LEAD_VIEWS)[number];

export const LEAD_VIEW_LABELS: Record<LeadView, string> = {
  intake: "New leads",
  quoting: "Quoting",
  out: "Out",
  won: "Won",
};

/** A live estimate for this lead, optionally narrowed by status. */
const hasEstimate = (tx: TenantTx, extra?: SQL): SQL =>
  exists(
    tx
      .select({ one: sql`1` })
      .from(estimates)
      .where(
        and(
          eq(estimates.orgId, leads.orgId),
          eq(estimates.leadId, leads.id),
          isNull(estimates.deletedAt),
          ...(extra ? [extra] : []),
        ),
      ),
  );

/** A visit booked against this customer — the other way a lead stops being untouched. */
const hasVisit = (tx: TenantTx): SQL =>
  exists(
    tx
      .select({ one: sql`1` })
      .from(jobVisits)
      .innerJoin(jobs, and(eq(jobs.orgId, jobVisits.orgId), eq(jobs.id, jobVisits.jobId)))
      .where(
        and(
          eq(jobVisits.orgId, leads.orgId),
          eq(jobs.leadId, leads.id),
          ne(jobVisits.status, "canceled"),
          isNull(jobVisits.deletedAt),
          isNull(jobs.deletedAt),
        ),
      ),
  );

/**
 * The predicate for one board column.
 *
 * MUTUALLY EXCLUSIVE by construction, so the four counts sum to the live book and no customer
 * appears in two columns. The board got that for free by partitioning an array; in SQL each column
 * has to exclude the ones before it explicitly.
 */
export const leadViewCondition = (view: LeadView, tx: TenantTx): SQL => {
  const live = isNull(leads.deletedAt);
  const sentQuote = hasEstimate(tx, eq(estimates.status, "sent"));
  const acceptedQuote = hasEstimate(tx, eq(estimates.status, "accepted"));

  switch (view) {
    case "intake":
      // Nobody has papered this customer: no estimate of any kind, no visit booked. NOT the same
      // as stage = "new" — a lead can sit at new with a quote already out.
      return and(live, sql`NOT ${hasEstimate(tx)}`, sql`NOT ${hasVisit(tx)}`) as SQL;
    case "quoting":
      // Work has been priced but nothing is out with the customer yet.
      return and(live, hasEstimate(tx), sql`NOT ${sentQuote}`, sql`NOT ${acceptedQuote}`) as SQL;
    case "out":
      // A quote is with the customer and undecided. Accepted wins if both exist — a customer who
      // said yes is WON even with another quote still open, which is what the board showed.
      return and(live, sentQuote, sql`NOT ${acceptedQuote}`) as SQL;
    case "won":
    default:
      return and(live, acceptedQuote) as SQL;
  }
};
