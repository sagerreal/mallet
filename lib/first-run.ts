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

// Whether a list page is still doing its FIRST load — the hydrator query is in flight and the store
// is empty, so there is nothing yet to show. Pages use this to render a loading affordance instead
// of a "nothing here" empty state, which during a cold reload would otherwise flash (e.g. telling a
// shop that HAS jobs "No jobs yet" for a beat before the rows arrive). Distinct from
// shouldShowFirstRun, which fires only once the load has SUCCEEDED and is genuinely empty.
export function isFirstLoad({ isFetched, isError, count }: FirstRunInput): boolean {
  return !isFetched && !isError && count === 0;
}
