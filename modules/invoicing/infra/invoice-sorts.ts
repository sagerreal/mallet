import { sql } from "drizzle-orm";
import { invoices } from "@mallet/shared/db/schema";
import { INVOICE_BANDS, type InvoiceView } from "./invoice-views";
import type { SortSpec } from "@mallet/shared/db/sort-page";

/**
 * The sorts the invoices list is willing to run. Named enum, never a column from the client —
 * same reasoning as job-sorts.ts and lead-sorts.ts.
 *
 * `oldestUnpaid` is the DEFAULT, and it is the only one of the three list defaults that is not
 * about recency. An invoice list exists to get money in, and money is collected oldest-first:
 * the bill that has been outstanding longest is both the most likely to go bad and the one a
 * customer is least likely to dispute chasing. Sorting invoices newest-first — the obvious
 * default — actively buries the ones that matter.
 *
 * ASCENDING on due date, NULLS LAST: an invoice with no due date is a draft that was never sent,
 * so it is not something anyone is chasing today and belongs at the bottom.
 *
 * Every entry needs an index on (org_id, <column>). See migration 0114.
 */
export const INVOICE_SORTS = ["ledger", "oldestUnpaid", "due", "amount", "created", "status"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

/**
 * The Money ledger's own order, ported from STATUS_RANK in features/money/money-derive.ts.
 *
 * It is a WORKFLOW order, not a column: things needing action first. `over` is not a status in the
 * database — it is derived from a sent invoice whose due date has passed — so this is a CASE
 * expression rather than a column sort, and it has to be one for the ledger to page in the order
 * it has always shown.
 *
 * Built from the SAME predicates as the status filter (INVOICE_BANDS), so the band a row sorts
 * into is by construction the band the filter puts it in. The first version of this duplicated the
 * rule and drifted immediately: it treated only a literally-'sent' invoice as overdue, so an
 * overdue part-payment sorted as part-paid under an Overdue pill.
 *
 * Draft ranking above overdue is arguable — an overdue bill is surely more urgent than one never
 * sent — but that is a product decision, not a side effect of moving the query, so it is left as
 * the screen has always shown it.
 */
export const LEDGER_RANK = sql<number>`case
  when ${invoices.status} = 'draft' then 1
  when ${INVOICE_BANDS.notDraft} and ${INVOICE_BANDS.owing} and ${INVOICE_BANDS.pastDue} then 2
  when ${INVOICE_BANDS.notDraft} and ${INVOICE_BANDS.owing} and ${invoices.amountPaidCents} > 0 then 3
  when ${INVOICE_BANDS.notDraft} and ${INVOICE_BANDS.owing} then 4
  else 5
end`;

/**
 * The ledger's order INSIDE one status band, when the screen has already filtered to that band.
 *
 * LEDGER_RANK answers "what needs attention first", and it is the right question for the whole
 * book. Applied to a filtered view it answers nothing: every row in the Paid view is rank 5, every
 * row in Overdue is rank 2. The rank ties for all of them and the only remaining ORDER BY key is
 * `id` — a random v4 UUID. So the Money screen's Status filter returned its rows in random order.
 *
 * Measured on the pilot org: the $185 cash payment the owner had just taken was rank 1 of 583 by
 * when it settled, and rank 290 by UUID — page 6 of a 50-row list, under a filter he had applied
 * precisely to find it. "I just took this payment, where is it?" had no answer.
 *
 * Each view therefore gets the order that view is FOR:
 *   paid   → most recently settled first. `updated_at` is the settle stamp — there is no paid_at
 *            column, and a payment write bumps it in the same transaction that closes the balance.
 *   draft  → newest first: a draft is something you are still writing.
 *   others → due date ascending, which is the collection order and the same order `oldestUnpaid`
 *            means. Overdue, part-paid and sent are all money being chased.
 *
 * The UNFILTERED ledger is untouched and stays needs-attention-first — that ordering is deliberate
 * and it is the one place the rank actually discriminates.
 */
const ledgerWithinView = (view: InvoiceView, dir?: "asc" | "desc"): SortSpec => {
  switch (view) {
    case "paid":
      return { column: invoices.updatedAt, direction: dir ?? "desc", nulls: "last" };
    case "draft":
      return { column: invoices.createdAt, direction: dir ?? "desc", nulls: "last" };
    case "over":
    case "partial":
    case "sent":
    default:
      return { column: invoices.dueAt, direction: dir ?? "asc", nulls: "last" };
  }
};

export const invoiceSortSpec = (
  sort: InvoiceSort,
  dir?: "asc" | "desc",
  view?: InvoiceView,
): SortSpec => {
  switch (sort) {
    case "ledger":
      // Inside a single status band the rank is constant, so it sorts nothing — see
      // ledgerWithinView. Unfiltered, it is ranked by the CASE above and the cursor carries the
      // rank, so paging resumes inside the right band rather than restarting at draft.
      if (view) return ledgerWithinView(view, dir);
      return { column: LEDGER_RANK, direction: dir ?? "asc", nulls: "last" };
    case "amount":
      return { column: invoices.totalCents, direction: dir ?? "desc", nulls: "last" };
    case "status":
      return { column: invoices.status, direction: dir ?? "asc", nulls: "last" };
    case "created":
      return { column: invoices.createdAt, direction: dir ?? "desc", nulls: "last" };
    case "due":
    case "oldestUnpaid":
    default:
      // Both map to due date ascending. They are separate names because the CALLER means
      // different things — "sort by due date" versus "show me the collection queue" — and the
      // scoped view that means the latter also applies an unpaid filter alongside it.
      return { column: invoices.dueAt, direction: dir ?? "asc", nulls: "last" };
  }
};
