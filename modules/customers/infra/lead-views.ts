import { and, eq, exists, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { leads, estimates, jobVisits, jobs, invoices } from "@mallet/shared/db/schema";
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
 * A scoped walkthrough: an estimate job's visit that came back with notes — the field half of
 * the quoting split (the tech's v1.field.setVisitNotes write IS the handoff signal). The office
 * owes this customer a quote before any estimate row exists, so the Quoting column must see
 * them. SQL twin of the client's scopedEstimateVisit (features/pipeline/pipeline-utils.ts).
 */
const hasScopedEstimateVisit = (tx: TenantTx): SQL =>
  exists(
    tx
      .select({ one: sql`1` })
      .from(jobVisits)
      .innerJoin(jobs, and(eq(jobs.orgId, jobVisits.orgId), eq(jobs.id, jobVisits.jobId)))
      .where(
        and(
          eq(jobVisits.orgId, leads.orgId),
          eq(jobs.leadId, leads.id),
          eq(jobs.svc, "estimate"),
          isNotNull(jobVisits.notes),
          ne(jobVisits.notes, ""),
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
      // Work has been priced — or a walkthrough came back scoped (the tech's visit-notes write)
      // — but nothing is out with the customer yet. Still exclusive of the columns after it,
      // and of intake, which excludes any visit-carrying lead.
      return and(
        live,
        or(hasEstimate(tx), hasScopedEstimateVisit(tx)),
        sql`NOT ${sentQuote}`,
        sql`NOT ${acceptedQuote}`,
      ) as SQL;
    case "out":
      // A quote is with the customer and undecided. Accepted wins if both exist — a customer who
      // said yes is WON even with another quote still open, which is what the board showed.
      return and(live, sentQuote, sql`NOT ${acceptedQuote}`) as SQL;
    case "won":
    default:
      return and(live, acceptedQuote) as SQL;
  }
};

/**
 * SCOPES — the Customers screen's saved worklists.
 *
 * Deliberately a separate axis from LEAD_VIEWS above. Those are the Pipeline board's columns and
 * are mutually exclusive by construction so their counts sum to the book; these are questions a
 * shop asks about its customer list, and a customer can easily be in both ("owes money" AND "no
 * work in a year" is precisely the customer you want to find).
 *
 * Both are answered with EXISTS/NOT EXISTS rather than a join: a customer with four unpaid
 * invoices must appear once, and a join would return them four times and break the keyset.
 */
export const LEAD_SCOPES = ["owesMoney", "cold12m"] as const;
export type LeadScope = (typeof LEAD_SCOPES)[number];

export const LEAD_SCOPE_LABELS: Record<LeadScope, string> = {
  owesMoney: "Owes money",
  cold12m: "No job in 12 months",
};

/** Nothing scheduled or done for this customer in a year — the win-back list. */
const COLD_MONTHS = 12;

export const leadScopeCondition = (scope: LeadScope, tx: TenantTx): SQL => {
  switch (scope) {
    case "owesMoney":
      // A sent bill with a balance still on it. Not `status = 'sent'`: an invoice part-paid down
      // to zero is settled whatever its status column says, and one marked paid with a balance
      // is not. The balance is the fact.
      return exists(
        tx
          .select({ one: sql`1` })
          .from(invoices)
          .where(
            and(
              eq(invoices.orgId, leads.orgId),
              eq(invoices.leadId, leads.id),
              isNull(invoices.deletedAt),
              ne(invoices.status, "draft"),
              sql`greatest(0, ${invoices.totalCents} - ${invoices.depositPaidCents} - ${invoices.amountPaidCents}) > 0`,
            ),
          ),
      ) as SQL;
    case "cold12m":
    default:
      // No visit in the last year. A customer with NO job at all is cold by this definition too —
      // which is right: the question is "who has not had us out", and never is longer than a year.
      return sql`NOT ${exists(
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
              sql`${jobVisits.scheduledDate} > (current_date - interval '${sql.raw(String(COLD_MONTHS))} months')`,
            ),
          ),
      )}` as SQL;
  }
};
