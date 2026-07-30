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
export const LEAD_SORTS = ["lastActivity", "name", "created", "value"] as const;
export type LeadSort = (typeof LEAD_SORTS)[number];

export const leadSortSpec = (sort: LeadSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
    case "name":
      // Ascending by default: a name list nobody asked to reverse should read A-Z.
      return { column: leads.name, direction: dir ?? "asc", nulls: "last" };
    case "value":
      return { column: leads.valueCents, direction: dir ?? "desc", nulls: "last" };
    case "created":
      return { column: leads.createdAt, direction: dir ?? "desc", nulls: "last" };
    case "lastActivity":
    default:
      return { column: leads.updatedAt, direction: dir ?? "desc", nulls: "last" };
  }
};

/** Value read off a row to build the next cursor — must match leadSortSpec's column exactly. */
export const leadSortValue = (sort: LeadSort, row: Record<string, unknown>): unknown => {
  switch (sort) {
    case "name": return row.name;
    case "value": return row.valueCents;
    case "created": return row.createdAt;
    case "lastActivity":
    default: return row.updatedAt;
  }
};
