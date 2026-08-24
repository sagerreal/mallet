"use client";

import { api, type RouterOutputs } from "@/lib/trpc/client";

export type ArtieStatus = "needs_you" | "working" | "done" | "closed";
export type ArtieTask = RouterOutputs["v1"]["agentTasks"]["list"]["items"][number];

export interface ArtieColumnData {
  readonly key: ArtieStatus;
  readonly tasks: readonly ArtieTask[];
  /** There are more rows in this status than were fetched, so the count is a floor, not a total. */
  readonly truncated: boolean;
}

/**
 * features/artie/use-artie-tasks.ts
 * ONE QUERY PER COLUMN — not one unfiltered query sliced four ways.
 *
 * WHY IT CHANGED. The unfiltered read asked for `limit: 50`, applied no status filter and threw
 * `nextCursor` away, while `list` orders globally by `updated_at desc`. There is no delete or
 * archive path for an agent task, so `done`/`closed` rows accumulate for ever — and a `needs_you`
 * task has an OLD `updated_at` precisely BECAUSE nobody has actioned it. So past roughly fifty
 * lifetime tasks the oldest untouched "Needs you" row silently fell off the page: no error, and a
 * column count that agreed with the cards while both were wrong. `MAX_OPEN_TASKS_PER_ORG` then
 * refuses new tasks and tells the owner to close some, which they cannot see.
 *
 * WHY FOUR QUERIES ARE NOT FOUR ROUND TRIPS. The tRPC client uses `httpBatchLink`
 * (lib/trpc/provider.tsx), so four queries issued in one render go out as ONE HTTP request. The
 * original objection to per-column fetching was four independent loading and error states showing
 * three columns of data beside one spinner — so they are collapsed here into one set of flags
 * (`isFetched` only once ALL four have landed, `isError` if ANY failed) and the board still renders
 * atomically. Counts still come from the same rows the cards do.
 *
 * WHY THESE LIMITS. The two OPEN columns are capped at 50, which is both the router's own maximum
 * and exactly `MAX_OPEN_TASKS_PER_ORG` — an org cannot hold more open tasks than that, so an open
 * task can never be lost, which is the property that matters. The two TERMINAL columns are a
 * deliberately bounded "recent" view; when there is more, `truncated` is true and the column head
 * says so rather than reporting a wrong total as if it were complete.
 */
const OPEN_LIMIT = 50;
const TERMINAL_LIMIT = 25;

const useColumnQuery = (status: ArtieStatus, limit: number) =>
  api.v1.agentTasks.list.useQuery(
    { status, limit },
    { refetchOnWindowFocus: true, placeholderData: (prev) => prev },
  );

type ColumnQuery = ReturnType<typeof useColumnQuery>;

const columnOf = (key: ArtieStatus, query: ColumnQuery): ArtieColumnData => ({
  key,
  tasks: query.data?.items ?? [],
  truncated: Boolean(query.data?.nextCursor),
});

export function useArtieTasks() {
  // Called unconditionally, four times, in a fixed order — never in a loop, so the hook order is
  // stable across renders (and `react-hooks/rules-of-hooks` stays satisfied).
  const needsYou = useColumnQuery("needs_you", OPEN_LIMIT);
  const working = useColumnQuery("working", OPEN_LIMIT);
  const done = useColumnQuery("done", TERMINAL_LIMIT);
  const closed = useColumnQuery("closed", TERMINAL_LIMIT);

  const columns: readonly ArtieColumnData[] = [
    columnOf("needs_you", needsYou),
    columnOf("working", working),
    columnOf("done", done),
    columnOf("closed", closed),
  ];
  const queries: readonly ColumnQuery[] = [needsYou, working, done, closed];
  // ANY failure is a failed board, not a partial one.
  const failed = queries.some((q) => q.isError);

  return {
    columns,
    /**
     * Raw flags, not a re-derived "isLoading" — the caller runs these through lib/first-run.ts's
     * isFirstLoad/shouldShowFirstRun/shouldShowLoadFailed (the shared predicates "Tasks" is named
     * as a consumer of in that file's own doc comment) rather than a second, easily-diverging copy
     * of that logic living here.
     *
     * `total` is ZERO whenever a column failed, and that is deliberate rather than defensive.
     * `shouldShowLoadFailed` fires only on `isError && count === 0`, on the sound general rule that
     * stale rows beat an error screen — but a board is ONE artifact, not four independent lists.
     * Reporting the three columns that did load would draw an EMPTY "Needs you" beside real Done
     * cards: "you have nothing waiting" when the truth is "we could not find out". Zero routes the
     * shared predicate to the retry, which is what actually happened.
     */
    total: failed ? 0 : columns.reduce((n, c) => n + c.tasks.length, 0),
    isError: failed,
    // EVERY column, so the board never renders half-loaded.
    isFetched: queries.every((q) => q.isFetched),
    isStale: queries.some((q) => q.isPlaceholderData),
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
    isRefetching: queries.some((q) => q.isRefetching),
  };
}
