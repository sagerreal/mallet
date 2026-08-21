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
 *
 * ONE REFETCH PER FLOW, NOT ONE PER WRITE (see withListBatch). "Create & price it" in the New Job
 * modal is not one write, it is a chain: create the customer, await it, create the job that needs
 * its id, await it, then the job's visits. Every link reconciled and invalidated, so one button
 * press ran the whole refetch three times over — and the first of them, the customers refetch, was
 * dispatched ONE MILLISECOND before v1.jobs.create, the request the user was actually blocked on
 * (measured in the browser: the refetch was in flight across the create in 3 of 3 presses). A flow
 * competing with itself for the connection and the database, to learn about rows it was still in
 * the middle of writing. withListBatch holds the refetch until the chain finishes and runs it once.
 */

/** The list domains a mutation can invalidate. Named, so a typo cannot silently invalidate nothing. */
export type ListDomain =
  | "jobs"
  | "customers"
  | "invoices"
  | "estimates"
  | "timesheets"
  | "settings";

let client: QueryClient | null = null;

/**
 * Open batches, and the domains they have collected so far.
 *
 * A depth counter rather than a boolean: a batched flow may call another batched flow, and only
 * the OUTERMOST close may flush — an inner close firing the refetch would put it right back on the
 * critical path it was moved off.
 */
let batchDepth = 0;
const pendingDomains = new Set<ListDomain>();

/** Called once by TrpcProvider. Idempotent — a re-render must not swap a live client. */
export function registerListCache(qc: QueryClient): void {
  client = qc;
}

/** Test seam: drop the reference so a suite cannot leak a client into the next one. */
export function resetListCache(): void {
  client = null;
  batchDepth = 0;
  pendingDomains.clear();
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
    case "settings":
      // NOT a list — the org's own configuration, and the one domain read by TWO audiences. The
      // office reads v1.settings.get; a technician can only ever see the narrow
      // v1.settings.fieldToggles. A toggle that refreshed just the office copy would flip on the
      // owner's screen and leave the crew's phones on the old answer until the 30s stale-time
      // expired, which is indistinguishable from the save having failed.
      return [getQueryKey(api.v1.settings.get), getQueryKey(api.v1.settings.fieldToggles)];
    case "timesheets":
    default:
      return [getQueryKey(api.v1.timesheets.list), getQueryKey(api.v1.timesheets.count)];
  }
};

/**
 * Ask React Query to refetch every list these domains own. The one place that touches the cache.
 *
 * Never throws and never awaits: a store mutation has already succeeded by the time this runs, and
 * a failed refetch must not turn a successful save into an error the user sees. The next focus
 * refetch picks it up.
 */
function refetchDomains(domains: Iterable<ListDomain>): void {
  if (!client) return;
  for (const domain of domains) {
    for (const queryKey of queriesFor(domain)) {
      client.invalidateQueries({ queryKey }).catch(() => {});
    }
  }
}

/**
 * Refetch the lists a write just changed — unless a batch is open, in which case the domain is
 * recorded and the refetch runs once when the batch closes.
 *
 * Deferring is safe in a way that dropping is not: the SAME domains are refetched with the SAME
 * keys a moment later, so the list the user is looking at still ends up correct. What goes away is
 * the duplication — three identical refetches of the same eight queries become one — and the
 * overlap with the writes the user is waiting on.
 */
export function invalidateLists(...domains: readonly ListDomain[]): void {
  if (!client) return;
  if (batchDepth > 0) {
    for (const domain of domains) pendingDomains.add(domain);
    return;
  }
  refetchDomains(domains);
}

/**
 * Run a multi-write flow with its list refetches held to the end.
 *
 * For a flow that writes once this changes nothing. For a chain — new customer, then the job that
 * needs its id, then the job's visits — it stops each link's refetch from competing with the next
 * link's write, and collapses the identical refetches into one.
 *
 * The flush is in `finally`, so a flow that FAILS still refreshes: a create that got as far as the
 * customer and then lost the job would otherwise leave the customer written to the database and
 * missing from every list on screen, which is the exact bug this module exists to prevent.
 */
export async function withListBatch<T>(run: () => Promise<T>): Promise<T> {
  batchDepth += 1;
  try {
    return await run();
  } finally {
    // Floored at zero: resetListCache can zero the counter from inside an open batch (a test seam,
    // and the only way that happens). Decrementing past zero from there would leave the module
    // permanently negative, and every LATER batch would close on a non-zero depth and never flush
    // — every list in the app silently stops refreshing.
    batchDepth = Math.max(0, batchDepth - 1);
    if (batchDepth === 0) {
      const domains = [...pendingDomains];
      pendingDomains.clear();
      refetchDomains(domains);
    }
  }
}
