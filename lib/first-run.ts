/**
 * lib/first-run.ts
 * Shared predicate for list-page first-run empty states (Customers, Pipeline, Tasks, …).
 * Pure — no store, no React. Pairs with components/shared/first-run-empty-state.tsx.
 */

// Whether a list page should show its first-run empty state instead of the list chrome. True ONLY
// on a SUCCESSFUL, empty load: a still-loading list (isFetched === false) must not flash the empty
// screen, and a FAILED load (isError) must not be mistaken for "no rows" (that would wrongly tell a
// real shop the page is empty). `count` is the TOTAL rows (incl. archived) — a page with only
// archived rows is not first-run.
export interface FirstRunInput {
  readonly isFetched: boolean;
  readonly isError: boolean;
  readonly count: number;
}

export function shouldShowFirstRun({ isFetched, isError, count }: FirstRunInput): boolean {
  return isFetched && !isError && count === 0;
}
