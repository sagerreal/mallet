import { estimates } from "@mallet/shared/db/schema";
import type { SortSpec } from "@mallet/shared/db/sort-page";

/**
 * The sorts the estimates list is willing to run.
 *
 * A NAMED enum, never a column from the client — same reasoning as job-sorts.ts.
 *
 * THERE IS NO "amount" SORT, and that is a deliberate refusal rather than an omission.
 * An estimate has no total column: the figure is built from its lines, each rounded, then a
 * discount in basis points, then tax — in the domain, in one place. Sorting by it in SQL means
 * writing that chain a second time in a second language, and the two WILL drift; the first
 * symptom is a list ordered by one number while every row displays another. The same reasoning
 * removed the Customers "value" column and keeps useRailColumns summing DTO totals instead of
 * re-deriving them in SQL.
 *
 * Making it possible is a schema change, not a sort: a cached total_cents on estimates,
 * maintained wherever lines are written, exactly as invoices.total_cents already works. Worth
 * doing when something needs it — not worth faking now.
 */
export const ESTIMATE_SORTS = ["created", "sent", "status"] as const;
export type EstimateSort = (typeof ESTIMATE_SORTS)[number];

/**
 * `created` is the DEFAULT and descends — the order this list has always come back in.
 *
 * `sent` descends too, NULLS LAST: an estimate that was never sent has no sent date, and it is not
 * something anyone is chasing, so it belongs after the ones that are.
 */
export const estimateSortSpec = (sort: EstimateSort, dir?: "asc" | "desc"): SortSpec => {
  switch (sort) {
    case "sent":
      return { column: estimates.sentAt, direction: dir ?? "desc", nulls: "last" };
    case "status":
      return { column: estimates.status, direction: dir ?? "asc", nulls: "last" };
    case "created":
    default:
      return { column: estimates.createdAt, direction: dir ?? "desc", nulls: "last" };
  }
};
