"use client";

import { useMemo } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { dtoEstimateSummaryToStore } from "@/lib/store/dto-mapper";
import { railRowsFor, deltaOf, type RailRow } from "@/features/quotes/derive";
import { deriveGetting, type GettingRow } from "@/features/board/working";
import { toStoreLead } from "@/features/customers/leads-hydrator";

/**
 * The work board's Quoting and Out columns, fetched for those columns.
 *
 * WHAT IS NOT HERE ANY MORE. This hook also fetched ACCEPTED quotes and derived a `won` row list,
 * for a Won column on `/pipeline`. That page is retired to a redirect, the board is the only
 * consumer left, and it never read `won` — so every mount was paying for a 200-row read whose
 * result nothing rendered. The board's own won FIGURE comes from the server's lead view counts
 * (`customers.viewCounts` → `leads.won`, see use-work-board.ts), not from these rows.
 *
 * WHAT WAS WRONG. Both columns were built by taking the loaded quotes and looking each one's
 * customer up in the loaded customers. Both collections are capped at one page, so a quote whose
 * customer had not loaded was dropped from the column ENTIRELY — no error, just a missing card,
 * and more of them the bigger the book grew. The header counts come from the database, so the
 * column could read "12" above five cards. It is the same fault that once showed $0 of quotes out
 * while $29,722 genuinely was.
 *
 * WHY THIS FIXES IT. The name now arrives ON the quote, resolved server-side, so there is no
 * lookup to fail. A card can render its customer without the customer being loaded at all.
 *
 * WHY THE ORPHAN FILTER IS GONE. deriveRail dropped quotes whose lead was missing or archived,
 * to avoid rendering "—". Archiving a customer cascades to their quotes server-side (see
 * archiveByLead), so the server does not return them — the filter now only removes rows whose
 * customer merely had not loaded, which is exactly the bug.
 *
 * NOT paginated. These are worklists — the prices a shop is building and the quotes it is chasing
 * — and both are capped with the cap reported rather than hidden.
 */

/** Past this many, a column is a backlog rather than a worklist, and the header says so. */
const COLUMN_CAP = 200;

/** Every read has answered at least once, empty or not — see RailColumns.hasData. */
const landed = (...reads: { data: unknown }[]): boolean =>
  reads.every((read) => read.data !== undefined);

export interface RailColumns {
  /** The Quoting column — customers with a price being built, chosen by the database. */
  readonly getting: GettingRow[];
  readonly out: RailRow[];
  /** Dollars sitting on customers' phones — the strip's headline figure. */
  readonly outSum: number;
  readonly outCount: number;
  readonly outTruncated: boolean;
  /** The newest customer act, named — or null when nothing has happened worth saying. */
  readonly delta: string | null;
  readonly isFetched: boolean;
  readonly isError: boolean;
  /**
   * Every read has answered at least once, empty or not.
   *
   * Distinct from `out.length > 0`, which a caller cannot use in its place: a shop with nothing
   * out on quotes has answered reads and no rows, and treating that as "no data" makes one
   * failed refetch look like a broken screen.
   */
  readonly hasData: boolean;
}

export function useRailColumns(): RailColumns {
  // Leads and jobs are still read from the store, but only to ENRICH a row — the card's send
  // actions want the full customer, and a Quoting card shows how long the work has been sitting.
  // Neither is required for the row to exist any more, which is the whole point.
  const leads = useAppStore((s) => s.leads);
  const jobs = useAppStore((s) => s.jobs);

  // The Quoting column's SET is decided in SQL (leadViewCondition "quoting" — priced but nothing
  // out with the customer yet), and its cards need the whole customer record, not just a name:
  // they show the job description and how long it has been sitting. So this fetches the customers
  // for that column and the drafts to pair with them, rather than filtering the loaded book.
  const quotingLeads = api.v1.customers.list.useQuery(
    { view: "quoting", limit: COLUMN_CAP, sort: "created" },
    { refetchOnWindowFocus: true },
  );
  const drafts = api.v1.quoting.list.useQuery(
    { status: "draft", limit: COLUMN_CAP },
    { refetchOnWindowFocus: true },
  );

  const sent = api.v1.quoting.list.useQuery(
    { status: "sent", limit: COLUMN_CAP },
    { refetchOnWindowFocus: true },
  );

  const getting = useMemo(() => {
    const leadRows = (quotingLeads.data?.items ?? []).map(toStoreLead);
    const draftRows = (drafts.data?.items ?? []).map((dto) =>
      dtoEstimateSummaryToStore(dto, { on: false, stage: 0 }),
    );
    // deriveGetting pairs the two and shapes the card. Passing SERVER-selected sets is what makes
    // that safe: its "skip a draft whose customer is missing" guard used to fire whenever the
    // customer merely had not loaded.
    return deriveGetting(leadRows, draftRows, jobs);
  }, [quotingLeads.data, drafts.data, jobs]);

  const sentItems = sent.data?.items;

  const out = useMemo(() => {
    const rows = (sentItems ?? []).map((dto) => ({
      // fu is client-local follow-up state; a list read carries none.
      est: dtoEstimateSummaryToStore(dto, { on: false, stage: 0 }),
      customerName: dto.customerName,
    }));
    return railRowsFor(rows, leads);
  }, [sentItems, leads]);

  return {
    getting,
    out,
    // Summed from the rows this column is actually showing, so the headline figure and the cards
    // under it can never disagree. Totals come from the DTO — the domain computed them, and
    // re-deriving lines → discount → tax here would be the same money maths in a second place.
    outSum: out.reduce((sum, r) => sum + r.total, 0),
    outCount: out.length,
    delta: deltaOf(out),
    outTruncated: (sentItems?.length ?? 0) >= COLUMN_CAP,
    isFetched: sent.isFetched && quotingLeads.isFetched && drafts.isFetched,
    isError: sent.isError || quotingLeads.isError || drafts.isError,
    hasData: landed(sent, quotingLeads, drafts),
  };
}
