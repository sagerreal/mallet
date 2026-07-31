"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/trpc/client";
import type { LeadSort } from "@/modules/customers/infra/lead-sorts";
import type { LeadScope } from "@/modules/customers/infra/lead-views";

/**
 * The Customers list, fetched a page at a time from the server.
 *
 * Replaces reading every lead out of the store and filtering it in the browser. That could only
 * ever see the hydrator's first 500 rows, so on a 606-customer shop the list, its search, its
 * filter options and its count all silently described a subset — and reported "500 of 500".
 *
 * Mirrors useJobsQuery: the page, the true total, and the filter facets, each its own query so the
 * "of N" survives paging and the dropdown describes the book rather than the page.
 */

const PAGE_SIZE = 50;

export interface CustomersQueryState {
  readonly search: string;
  readonly stage: string;
  readonly source: string;
  /** A saved worklist — owes money, no job in 12 months. "" is everyone. */
  readonly scope: string;
  readonly sort: LeadSort | null;
  readonly sortDir: "asc" | "desc" | null;
}

export function useCustomersQuery(state: CustomersQueryState) {
  const search = state.search.trim() || undefined;
  const stage = state.stage || undefined;
  const source = state.source || undefined;
  const scope = state.scope || undefined;

  // ONE filter object for the page, the count and nothing else — they cannot describe different
  // sets, which is how a header ends up reading "50 of 606" over a twelve-row worklist.
  const filters = {
    ...(search ? { search } : {}),
    ...(stage ? { stage: stage as never } : {}),
    ...(source ? { source } : {}),
    ...(scope ? { scope: scope as LeadScope } : {}),
  };

  const page = api.v1.customers.list.useInfiniteQuery(
    {
      limit: PAGE_SIZE,
      ...filters,
      ...(state.sort ? { sort: state.sort } : {}),
      ...(state.sortDir ? { sortDir: state.sortDir } : {}),
    },
    {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      // No staleTime: a list that serves a cached page after an edit is how "I changed that and it
      // didn't save" gets reported.
      refetchOnWindowFocus: true,
    },
  );

  const total = api.v1.customers.count.useQuery(filters, { refetchOnWindowFocus: true });

  // Facets are NOT filtered by the current selection: a dropdown that hides the option you would
  // switch to is a dead end. It describes the whole book, always.
  const facets = api.v1.customers.facets.useQuery(undefined, { refetchOnWindowFocus: true });

  const rows = useMemo(() => page.data?.pages.flatMap((p) => p.items) ?? [], [page.data]);

  const loadMore = useCallback(() => {
    if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
  }, [page]);

  return {
    rows,
    shown: rows.length,
    total: total.data?.total,
    stageCounts: facets.data?.stages,
    sources: facets.data?.sources,
    hasMore: Boolean(page.hasNextPage),
    loadMore,
    isLoadingMore: page.isFetchingNextPage,
    isLoading: page.isLoading,
    isError: page.isError,
    isFetched: page.isFetched,
    refetch: () => void page.refetch(),
    isRefetching: page.isRefetching,
  };
}

/** The list's own filter/sort state, kept out of the component so it can be tested. */
export function useCustomersQueryState() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [source, setSource] = useState("");
  const [scope, setScope] = useState("");
  // The DISPLAY column is tracked, not the server sort: the header arrow belongs to the column the
  // user clicked, and two columns can map to the same server sort.
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  /** Clicking the active column flips direction; a new column starts on its natural default. */
  const toggleSortCol = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev !== col) {
        setSortDir(null);
        return col;
      }
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return prev;
    });
  }, []);

  const clear = useCallback(() => {
    setSearch("");
    setStage("");
    setSource("");
    setScope("");
  }, []);

  return { search, setSearch, stage, setStage, source, setSource, scope, setScope, sortCol, sortDir, toggleSortCol, clear };
}

/** Table column → named server sort. Columns with no server sort map to null and stay inert. */
export const CUSTOMER_COL_TO_SORT: Record<string, LeadSort | null> = {
  name: "name",
  latest: "lastActivity",
  age: "created",
  // Stage sorts alphabetically, which is not the pipeline order anyone means by it — left inert
  // rather than sorting by a sequence that reads as arbitrary.
  stage: null,
  phone: null,
  email: null,
  address: null,
};
