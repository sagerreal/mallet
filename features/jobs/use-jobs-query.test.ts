// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * What the hook ASKS THE SERVER FOR.
 *
 * The list and its "of N" total are two separate queries, and the whole point of the header is
 * that both ask the same question. They did not: the count sent only `search`, so "50 of 1528"
 * counted the entire book underneath a filtered page — on both tabs, under every filter.
 */
const calls = { list: [] as unknown[], count: [] as unknown[] };
const stub = { data: undefined, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), isPlaceholderData: false, isLoading: false, isError: false, isFetched: true, refetch: vi.fn(), isRefetching: false };

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      jobs: {
        list: { useInfiniteQuery: (args: unknown) => (calls.list.push(args), stub) },
        count: { useQuery: (args: unknown) => (calls.count.push(args), { data: { total: 0 } }) },
        viewCounts: { useQuery: () => ({ data: undefined }) },
      },
    },
  },
}));
// The debounce is timing, not filtering — the hook's arguments are what this file is about.
vi.mock("@/lib/use-debounced-value", () => ({ useDebouncedValue: (v: string) => v }));

import { useJobsQuery, useJobsQueryState, localToday, type JobsQueryState } from "./use-jobs-query";

const state = (over: Partial<JobsQueryState> = {}): JobsQueryState => ({
  view: null,
  search: "",
  sort: null,
  sortDir: null,
  excludeArchived: false,
  ...over,
});

/** The list args, and the FILTERED count's args (the second count call is the unfiltered book). */
const run = (s: JobsQueryState) => {
  calls.list = [];
  calls.count = [];
  renderHook(() => useJobsQuery(s));
  return {
    list: calls.list[0] as Record<string, unknown>,
    count: calls.count[0] as Record<string, unknown>,
    bookCount: calls.count[1] as Record<string, unknown>,
  };
};

describe("useJobsQuery — the All filter reaches the server", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends excludeArchived on BOTH the page and the total, with today", () => {
    // "All" means everything the archive does not already hold. It used to send activeOnly, which
    // excludes ALL finished work — so All read 39 while the seven bands summed to 65.
    const { list, count } = run(state({ excludeArchived: true }));
    expect(list.excludeArchived).toBe(true);
    expect(count.excludeArchived).toBe(true);
    // The archived predicate is date-relative, so it cannot be evaluated without the client's day.
    expect(list.today).toBe(localToday());
    expect(count.today).toBe(localToday());
  });

  it("omits excludeArchived entirely when a band is chosen", () => {
    // Absent, not `false`: an explicitly false flag is a different cache key for the same question.
    const { list, count } = run(state({ excludeArchived: false }));
    expect("excludeArchived" in list).toBe(false);
    expect("excludeArchived" in count).toBe(false);
  });

  it("counts the same SET the page shows when a view is selected", () => {
    const { list, count } = run(state({ view: "done", excludeArchived: false }));
    expect(list.view).toBe("done");
    expect(count.view).toBe("done");
    // The date-relative views cannot be evaluated without the client's local date, and the server
    // now rejects a view sent without one rather than silently counting the whole book.
    expect(count.today).toBe(localToday());
  });

  it("carries the search into both, as it always did", () => {
    const { list, count } = run(state({ search: "  heater  ", excludeArchived: true }));
    expect(list.search).toBe("heater");
    expect(count.search).toBe("heater");
    expect(count.excludeArchived).toBe(true);
  });

  it("leaves the unfiltered BOOK count unfiltered — it is the first-run gate", () => {
    // Gating first-run on the filtered total told a shop with hundreds of jobs "No jobs yet" the
    // moment a search matched nothing.
    const { bookCount } = run(state({ excludeArchived: true, search: "heater", view: "done" }));
    expect(bookCount).toEqual({});
  });
});

// Owen, Aug 11: "the default view should probably be today" — a dispatcher opens Jobs to run the
// day, not to scroll a 688-row book that buries today's work under months of older dates.
describe("useJobsQueryState — the list opens on Today", () => {
  it("defaults the view to 'today', not All", () => {
    const { result } = renderHook(() => useJobsQueryState());
    expect(result.current.view).toBe("today");
  });
});
