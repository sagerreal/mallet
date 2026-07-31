"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/trpc/client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";
import { dtoInvoiceSummaryToStore } from "@/lib/store/dto-mapper";
import { localToday } from "@/features/jobs/use-jobs-query";
import type { InvoiceView } from "@/modules/invoicing/infra/invoice-views";

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
  /**
   * The ledger band being shown, or "" for all of it.
   *
   * "ready" is the odd one: it is not an invoice at all, it is a finished job nobody has billed.
   * So it selects the worklist and suppresses the invoice query entirely, rather than being
   * passed to it as a filter it has no way to satisfy.
   */
  readonly statusFilter: string;
}

export function useMoneyQuery(state: MoneyQueryState) {
  const today = useMemo(localToday, []);
  // Query trails the input — no query per keystroke (see lib/use-debounced-value).
  const debouncedSearch = useDebouncedValue(state.search, 250);
  const search = debouncedSearch.trim() || undefined;
  const onlyReady = state.statusFilter === "ready";
  // Anything other than "ready" (or nothing) is an invoice band the database can answer.
  const view = !state.statusFilter || onlyReady ? undefined : (state.statusFilter as InvoiceView);
  // Filtering to an invoice band means the ready-to-bill worklist is not part of the answer.
  const wantReady = !state.archived && (!state.statusFilter || onlyReady);

  // Finished work with no invoice — the jobs module already answers this as a scoped view, so the
  // ledger reuses it rather than growing a second definition of "ready to bill".
  const ready = api.v1.jobs.list.useQuery(
    { view: "needsInvoice", today, limit: READY_CAP },
    { refetchOnWindowFocus: true, enabled: wantReady },
  );

  const invoices = api.v1.invoicing.list.useInfiniteQuery(
    { limit: PAGE_SIZE, sort: "ledger", ...(search ? { search } : {}), ...(view ? { view } : {}) },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      refetchOnWindowFocus: true,
      // Previous rows stay on screen (dimmed) while a new filter loads.
      placeholderData: (prev) => prev,
    },
  );

  const total = api.v1.invoicing.count.useQuery(
    { ...(search ? { search } : {}), ...(view ? { view } : {}) },
    { refetchOnWindowFocus: true, placeholderData: (prev) => prev },
  );
  // Unfiltered book size — the honest first-run input.
  const bookTotal = api.v1.invoicing.count.useQuery({}, { refetchOnWindowFocus: false });

  const readyJobs = useMemo(
    () => (wantReady ? (ready.data?.items ?? []).map((j) => dtoJobToStoreJob(j as never)) : []),
    [ready.data, wantReady],
  );
  const invoiceRows = useMemo(
    () =>
      // Filtering to ready-to-bill means no invoice belongs in the answer, so the rows are dropped
      // rather than the query being disabled — its cache stays warm for when the filter clears.
      (onlyReady ? [] : (invoices.data?.pages.flatMap((p) => p.items) ?? [])).map((i) =>
        // The SUMMARY mapper, not the full one. Passing a list row to dtoInvoiceToStore read
        // `dto.tax.cents` off a field the summary does not carry and threw — which is what put
        // "Something went wrong" on the Money page. Phone and email genuinely are not on a
        // summary and the ledger does not render them, so they are empty rather than guessed.
        dtoInvoiceSummaryToStore(i, { cust: "—", phone: "", email: "" }),
      ),
    [invoices.data, onlyReady],
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
    total: total.data === undefined ? undefined : (onlyReady ? 0 : total.data.total) + readyJobs.length,
    bookTotal: bookTotal.data?.total,
    isStale: invoices.isPlaceholderData || debouncedSearch !== state.search,
    hasMore: Boolean(invoices.hasNextPage) && !onlyReady,
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
