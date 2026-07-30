import { invoices } from "@mallet/shared/db/schema";
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
export const INVOICE_SORTS = ["oldestUnpaid", "due", "amount", "created", "status"] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

export const invoiceSortSpec = (sort: InvoiceSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
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

/** Value read off a row to build the next cursor — must match invoiceSortSpec's column exactly. */
export const invoiceSortValue = (sort: InvoiceSort, row: Record<string, unknown>): unknown => {
  switch (sort) {
    case "amount": return row.totalCents;
    case "status": return row.status;
    case "created": return row.createdAt;
    case "due":
    case "oldestUnpaid":
    default: return row.dueAt;
  }
};
