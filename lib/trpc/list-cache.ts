"use client";

import type { QueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api } from "./client";

/**
 * The bridge between the store's mutations and the server-paginated lists.
 *
 * THE PROBLEM THIS SOLVES. The lists used to read the store, so an optimistic write appeared
 * instantly and everything agreed. Now Jobs, Customers, Money, the Pipeline columns and the
 * dispatch board render QUERY data — a page fetched from the database — while their mutations
 * still write to the store. Nothing connected the two, so creating a customer wrote the row to the
 * database and to the store, and the list you were looking at did not show it until the window
 * lost and regained focus. The row was saved; the screen said otherwise, which is the version of
 * this bug that gets reported as data loss.
 *
 * WHY A MODULE-LEVEL CLIENT RATHER THAN useUtils(). The mutations live in Zustand slices, which
 * are not React components and cannot call hooks. The QueryClient is created inside the provider,
 * so the provider hands it here on mount and the slices reach it through this module. That keeps
 * the optimistic-write model exactly as it was and adds one line at each reconcile point, instead
 * of moving every mutation into a component.
 *
 * INVALIDATE, DON'T PATCH. The alternative is editing the cached page in place. That is wrong for
 * a paginated list: an edit can move a row to a different page (rescheduling a job out of "today",
 * paying an invoice off out of "overdue"), and the page it lands on may not be loaded. Patching
 * would have to reimplement every sort and filter in the browser — the exact duplication this
 * whole plan removed. A refetch asks the database, which is the thing that knows.
 *
 * TIMING: only ever call this AFTER the server write resolves. Invalidating alongside the
 * optimistic set starts a refetch that races the write, and the response — taken before the commit
 * — would render the row back to its old value.
 */

/** The list domains a mutation can invalidate. Named, so a typo cannot silently invalidate nothing. */
export type ListDomain = "jobs" | "customers" | "invoices" | "estimates" | "timesheets";

let client: QueryClient | null = null;

/** Called once by TrpcProvider. Idempotent — a re-render must not swap a live client. */
export function registerListCache(qc: QueryClient): void {
  client = qc;
}

/** Test seam: drop the reference so a suite cannot leak a client into the next one. */
export function resetListCache(): void {
  client = null;
}

/**
 * The queries each domain owns.
 *
 * Deliberately includes the COUNT and facet queries, not just the list: the header reads "50 of
 * 606" and the filter dropdown offers stages from the whole book, so a create that refreshed only
 * the rows would leave the total behind and the list would say 51 of 606.
 *
 * Keys come from getQueryKey with no input, which tRPC treats as a prefix — so one call covers
 * every page, filter and sort variant of that list currently in the cache.
 */
const queriesFor = (domain: ListDomain): unknown[][] => {
  switch (domain) {
    case "jobs":
      // The FIELD reads ride along: v1.field.myDay is the tech's agenda and v1.field.myJobs the
      // time editor's job picker. Reassigning a visit is a jobs write, and before these keys were
      // here it never reached the tech's phone — the dispatcher moved the job, My day kept showing
      // yesterday's answer until a manual reload. (My hours needs no entry: it reads
      // v1.timesheets.list, which the "timesheets" domain already covers by prefix.)
      return [
        getQueryKey(api.v1.jobs.list),
        getQueryKey(api.v1.jobs.count),
        getQueryKey(api.v1.jobs.viewCounts),
        getQueryKey(api.v1.field.myDay),
        getQueryKey(api.v1.field.myJobs),
      ];
    case "customers":
      return [
        getQueryKey(api.v1.customers.list),
        getQueryKey(api.v1.customers.count),
        getQueryKey(api.v1.customers.facets),
        getQueryKey(api.v1.customers.viewCounts),
      ];
    case "invoices":
      return [getQueryKey(api.v1.invoicing.list), getQueryKey(api.v1.invoicing.count)];
    case "estimates":
      return [getQueryKey(api.v1.quoting.list)];
    case "timesheets":
    default:
      return [getQueryKey(api.v1.timesheets.list), getQueryKey(api.v1.timesheets.count)];
  }
};

/**
 * Refetch the lists a write just changed.
 *
 * Never throws and never awaits: a store mutation has already succeeded by the time this runs, and
 * a failed refetch must not turn a successful save into an error the user sees. The next focus
 * refetch picks it up.
 */
export function invalidateLists(...domains: readonly ListDomain[]): void {
  if (!client) return;
  for (const domain of domains) {
    for (const queryKey of queriesFor(domain)) {
      client.invalidateQueries({ queryKey }).catch(() => {});
    }
  }
}
