import { leads } from "@mallet/shared/db/schema";
import type { SortSpec } from "@mallet/shared/db/sort-page";

/**
 * The sorts the customers list is willing to run.
 *
 * Named enum, never a column from the client — same reasoning as job-sorts.ts: a client-supplied
 * column is an injection surface and welds the public API to the table layout.
 *
 * `lastActivity` is the DEFAULT, mapped to updated_at. A shop scanning its customer list is
 * looking for who they last dealt with, not who was entered into the system first — and on an
 * imported book of business, created_at is the day of the import for every single row, which
 * makes it a useless ordering exactly when the list is biggest.
 *
 * Every entry needs an index on (org_id, <column>) or the query is a sequential scan over the
 * tenant. See migration 0113.
 */
/**
 * `value` was removed after checking the data: of 606 customers, ZERO carry a stored value_cents,
 * so the sort ordered every row by 0. The column the Customers table displayed was a different
 * number again — derived in the browser from open/won estimates — so the sort and the column it
 * sat under never agreed in the first place.
 *
 * Deal value belongs on /pipeline, which exists for it. A customer list is a directory: find the
 * person, see their state. Jobber's clients list carries Name, Address, Tags, Status and Last
 * Activity, and no value column, which is the same conclusion from the other direction.
 */
export const LEAD_SORTS = ["lastActivity", "name", "created"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const leadSortSpec = (sort: LeadSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
    case "name":
      // Ascending by default: a name list nobody asked to reverse should read A-Z.
      return { column: leads.name, direction: dir ?? "asc", nulls: "last" };
    case "created":
      return { column: leads.createdAt, direction: dir ?? "desc", nulls: "last" };
    case "lastActivity":
    default:
      return { column: leads.updatedAt, direction: dir ?? "desc", nulls: "last" };
  }
};
