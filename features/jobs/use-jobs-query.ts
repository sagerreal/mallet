"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/trpc/client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { JobView } from "@/modules/jobs/infra/job-views";
import type { JobSort } from "@/modules/jobs/infra/job-sorts";

/**
 * The Jobs list, fetched a page at a time from the server.
 *
 * Replaces reading `store.jobs` and filtering it in the browser. That approach could only ever
 * see the hydrator's first 500 rows, so on a shop with 1,521 jobs the list, its counts and its
 * search all silently described a subset — and said "220 of 220" while doing it.
 *
 * WHAT LIVES HERE AND WHY
 * All the list's server state in one hook, so the screen has one thing to render and no component
 * can drift into filtering rows itself. Three queries, deliberately separate:
 *   - the page      (useInfiniteQuery — rows arrive as you scroll)
 *   - the total     (its own count query — survives paging, and is the honest "of N")
 *   - the view tabs (all six band counts in one round trip)
 *
 * `today` is the CLIENT's local date. There is no org timezone column, and the bands were always
 * computed from the dispatcher's browser clock — which for a single-location shop is the shop's
 * clock. See modules/jobs/infra/job-views.ts.
 */

const PAGE_SIZE = 50;

export interface JobsQueryState {
  readonly view: JobView | null;
  readonly search: string;
  readonly sort: JobSort | null;
  readonly sortDir: "asc" | "desc" | null;
}

/** Today in the browser's own timezone — never toISOString(), which is UTC and shifts the day. */
export function localToday(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function useJobsQuery(state: JobsQueryState) {
  const today = useMemo(localToday, []);
  // Query trails the input (see lib/use-debounced-value) — no query per keystroke.
  const debouncedSearch = useDebouncedValue(state.search, 250);
  const search = debouncedSearch.trim() || undefined;

  const listArgs = {
    limit: PAGE_SIZE,
    today,
    ...(state.view ? { view: state.view } : {}),
    ...(search ? { search } : {}),
    ...(state.sort ? { sort: state.sort } : {}),
    ...(state.sortDir ? { sortDir: state.sortDir } : {}),
  };

  const page = api.v1.jobs.list.useInfiniteQuery(listArgs, {
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Previous rows stay on screen (dimmed) while a new filter loads — never a full swap.
    placeholderData: (prev) => prev,
    // No staleTime: a list that quietly serves a cached page after an edit is how "I changed that
    // and it didn't save" reports get filed. Refetch on focus for the same reason.
    refetchOnWindowFocus: true,
  });

  // The honest "of N". Its own query so it survives paging and matches the list's filters exactly
  // — count and list share one predicate builder on the server.
  const total = api.v1.jobs.count.useQuery(
    { ...(search ? { search } : {}) },
    { refetchOnWindowFocus: true, placeholderData: (prev) => prev },
  );
  // Unfiltered book size — the only honest first-run input (a no-match search reads 0).
  const bookTotal = api.v1.jobs.count.useQuery({}, { refetchOnWindowFocus: false });

  const viewCounts = api.v1.jobs.viewCounts.useQuery(
    { today, ...(search ? { search } : {}) },
    { refetchOnWindowFocus: true },
  );

  const rows = useMemo(() => page.data?.pages.flatMap((p) => p.items) ?? [], [page.data]);

  const loadMore = useCallback(() => {
    if (page.hasNextPage && !page.isFetchingNextPage) void page.fetchNextPage();
  }, [page]);

  return {
    rows,
    /** Rows currently loaded — what "showing n" means. */
    shown: rows.length,
    /** Everything matching the search, across every view. Undefined until it lands. */
    total: total.data?.total,
    bookTotal: bookTotal.data?.total,
    isStale: page.isPlaceholderData || debouncedSearch !== state.search,
    /** Per-view counts for the filter pill. */
    counts: viewCounts.data,
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
export function useJobsQueryState() {
  const [view, setView] = useState<JobView | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<JobSort | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc" | null>(null);

  /** Clicking the active column flips direction; a new column starts on its natural default. */
  const toggleSort = useCallback(
    (col: JobSort) => {
      setSort((prev) => {
        if (prev !== col) {
          setSortDir(null);
          return col;
        }
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      });
    },
    [],
  );

  const clear = useCallback(() => {
    setView(null);
    setSearch("");
  }, []);

  return { view, setView, search, setSearch, sort, sortDir, toggleSort, clear };
}
