"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/trpc/client";
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";
import { dtoInvoiceToStore } from "@/lib/store/dto-mapper";
import { localToday } from "@/features/jobs/use-jobs-query";

/**
 * The Money ledger, served by the server.
 *
 * This screen is the awkward one: the ledger is not a list of one table, it is a UNION of jobs
 * ready to bill and live invoices, ranked together — ready, draft, overdue, partial, sent, paid.
 * A merged, ranked view over two sources cannot be keyset-paginated, because the sort key spans
 * both.
 *
 * THE SPLIT, chosen after measuring the real org (1 ready to bill, 847 invoices):
 *
 *   READY TO BILL is fetched WHOLE. It is a worklist — finished work nobody has invoiced — and it
 *   is inherently short. If it is ever long, that is precisely the signal this screen exists to
 *   give, and burying it behind a "load more" would hide the thing the owner most needs to see.
 *   Capped anyway, because "inherently short" is an assumption about a shop, not a guarantee.
 *
 *   INVOICES paginate, in the ledger's own rank order.
 *
 * Because `ready` ranks 0, those rows sit above every invoice regardless — so the two halves can
 * simply be concatenated, with no union query and no ranking logic duplicated across sources.
 */

const PAGE_SIZE = 50;
/** Ready-to-bill is a worklist, not a list. Past this the screen says so rather than scrolling. */
const READY_CAP = 200;

export interface MoneyQueryState {
  readonly search: string;
  readonly archived: boolean;
}

export function useMoneyQuery(state: MoneyQueryState) {
  const today = useMemo(localToday, []);
  const search = state.search.trim() || undefined;

  // Finished work with no invoice — the jobs module already answers this as a scoped view, so the
  // ledger reuses it rather than growing a second definition of "ready to bill".
  const ready = api.v1.jobs.list.useQuery(
    { view: "needsInvoice", today, limit: READY_CAP },
    { refetchOnWindowFocus: true, enabled: !state.archived },
  );

  const invoices = api.v1.invoicing.list.useInfiniteQuery(
    { limit: PAGE_SIZE, sort: "ledger", ...(search ? { search } : {}) },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchOnWindowFocus: true,
    },
  );

  const total = api.v1.invoicing.count.useQuery(
    { ...(search ? { search } : {}) },
    { refetchOnWindowFocus: true },
  );

  const readyJobs = useMemo(
    () => (state.archived ? [] : (ready.data?.items ?? []).map((j) => dtoJobToStoreJob(j as never))),
    [ready.data, state.archived],
  );
  const invoiceRows = useMemo(
    () =>
      (invoices.data?.pages.flatMap((p) => p.items) ?? []).map((i) =>
        // dtoInvoiceToStore needs a prior record for the fields the DTO does not carry. The
        // customer NAME now comes from the server; phone and email genuinely are not on the
        // summary, and the ledger does not render them — so they are empty rather than guessed.
        dtoInvoiceToStore(i as never, {
          cust: i.customerName ?? "—",
          phone: "",
          email: "",
        } as never),
      ),
    [invoices.data],
  );

  const loadMore = useCallback(() => {
    if (invoices.hasNextPage && !invoices.isFetchingNextPage) void invoices.fetchNextPage();
  }, [invoices]);

  return {
    /** Jobs finished but unbilled — the whole worklist, not a page of it. */
    readyJobs,
    /** Invoices, in ledger order, one page at a time. */
    invoiceRows,
    /** True when the worklist hit its cap and is being truncated — the UI must say so. */
    readyTruncated: readyJobs.length >= READY_CAP,
    shown: readyJobs.length + invoiceRows.length,
    total: total.data === undefined ? undefined : total.data.total + readyJobs.length,
    hasMore: Boolean(invoices.hasNextPage),
    loadMore,
    isLoadingMore: invoices.isFetchingNextPage,
    isLoading: invoices.isLoading,
    isError: invoices.isError,
    isFetched: invoices.isFetched,
    refetch: () => void invoices.refetch(),
    isRefetching: invoices.isRefetching,
  };
}

/** The ledger's own filter state, kept out of the component so it can be tested. */
export function useMoneyQueryState() {
  const [search, setSearch] = useState("");
  const clear = useCallback(() => setSearch(""), []);
  return { search, setSearch, clear };
}
