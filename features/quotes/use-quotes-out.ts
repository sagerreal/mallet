"use client";

import { useMemo } from "react";
import { api } from "@/lib/trpc/client";

/**
 * The quotes that are OUT with customers — the Pipeline strip's headline figure.
 *
 * It read "$0" on a shop with twelve sent quotes worth $29,722. Not a rounding problem and not a
 * missing feature: deriveRail requires each estimate's LEAD to be present in the loaded
 * collection, and those customers were created early enough to fall outside the newest-500 window
 * the hydrator fetches. The quotes were loaded; their customers were not; the join silently
 * dropped every row.
 *
 * WHY THIS FETCHES ROWS RATHER THAN SUMMING IN SQL.
 * An estimate's total is not a column — it is line items, each rounded, then a discount in basis
 * points, then tax. Re-implementing that chain in SQL would put the same money maths in two places,
 * and the two WILL drift; that is exactly why the Customers Value column was removed rather than
 * ported. The list DTO already carries a total computed by the domain, so summing those is correct
 * by construction.
 *
 * Affordable because sent quotes are a WORKLIST, not a ledger: they are the ones a shop is chasing
 * this week. Capped anyway, and the cap is reported rather than hidden.
 */

/** Sent quotes past this many are not a pipeline, they are a backlog — and the strip says so. */
const OUT_CAP = 200;

export function useQuotesOut() {
  const sent = api.v1.quoting.list.useQuery(
    { status: "sent", limit: OUT_CAP },
    { refetchOnWindowFocus: true },
  );

  const items = useMemo(() => sent.data?.items ?? [], [sent.data]);

  return {
    /** Dollars out with customers. Totals come from the DTO — the domain computed them. */
    outSum: useMemo(() => items.reduce((s, e) => s + e.total.cents, 0) / 100, [items]),
    count: items.length,
    /** True when the cap bit, so the figure is a floor rather than the whole number. */
    truncated: items.length >= OUT_CAP,
    isLoading: sent.isLoading,
    isFetched: sent.isFetched,
  };
}
