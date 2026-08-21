"use client";

import { api, type RouterOutputs } from "@/lib/trpc/client";

export type ArtieStatus = "needs_you" | "working" | "done" | "closed";
export type ArtieTask = RouterOutputs["v1"]["agentTasks"]["list"]["items"][number];

export interface ArtieColumnData {
  readonly key: ArtieStatus;
  readonly tasks: readonly ArtieTask[];
}

/**
 * features/artie/use-artie-tasks.ts
 * One list read, sliced client-side into the four columns.
 *
 * ONE query, not four: four queries would each carry their own loading and error state, and the
 * board would show three columns of data beside one spinner — the exact "the page reloads" feel
 * the customers list was fixed for. The column counts come from the same rows the cards do, so a
 * count can never disagree with what is on screen.
 */
export function useArtieTasks() {
  const query = api.v1.agentTasks.list.useQuery(
    { limit: 50 },
    { refetchOnWindowFocus: true, placeholderData: (prev) => prev },
  );

  const items = query.data?.items ?? [];
  const byStatus = (status: ArtieStatus): ArtieTask[] => items.filter((t) => t.status === status);

  const columns: readonly ArtieColumnData[] = [
    { key: "needs_you", tasks: byStatus("needs_you") },
    { key: "working", tasks: byStatus("working") },
    { key: "done", tasks: byStatus("done") },
    { key: "closed", tasks: byStatus("closed") },
  ];

  return {
    columns,
    // Raw flags, not a re-derived "isLoading" — the caller runs these through lib/first-run.ts's
    // isFirstLoad/shouldShowFirstRun/shouldShowLoadFailed (the shared predicates "Tasks" is named
    // as a consumer of in that file's own doc comment) rather than a second, easily-diverging copy
    // of that logic living here.
    total: items.length,
    isError: query.isError,
    isFetched: query.isFetched,
    isStale: query.isPlaceholderData,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}
