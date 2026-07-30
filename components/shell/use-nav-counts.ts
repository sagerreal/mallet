"use client";

import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

/**
 * The numbers on the nav badges, counted by the DATABASE.
 *
 * They used to be `store.jobs.filter(...).length`, which counts what the browser happens to have
 * loaded. The hydrators fetch one page of 500, so a shop with 1,521 jobs and 606 customers saw
 * "500" on both badges — the same number, because both had hit the same ceiling, which is exactly
 * how the bug announced itself.
 *
 * WHY A SEPARATE QUERY RATHER THAN A FIELD ON THE LIST. The badge has to be right on every screen,
 * including ones that never load a job list at all. Deriving it from a list response would tie the
 * sidebar to whatever page some other screen last fetched.
 *
 * Falls back to `undefined` while loading rather than 0. A badge that reads 0 for a beat and then
 * jumps to 1,400 looks like data appearing out of nowhere; no badge simply appears late.
 */
export interface NavCounts {
  /** Open jobs — everything except complete and canceled. */
  readonly jobs: number | undefined;
  /** Active customers. */
  readonly customers: number | undefined;
  /** Invoices with money still owed. */
  readonly money: number | undefined;
}

export function useNavCounts(): NavCounts {
  // staleTime matches the hydrators so a badge and the list it labels refresh together rather
  // than disagreeing for a window after a mutation.
  const opts = { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: true } as const;
  const jobs = api.v1.jobs.count.useQuery({ activeOnly: true }, opts);
  const customers = api.v1.customers.count.useQuery({}, opts);
  // Money owed, counted in the database for the same reason as the other two: the store holds the
  // NEWEST 500 invoices, and on this shop all three outstanding ones were raised early enough to
  // fall outside that window — so the badge showed nothing while three invoices were unpaid.
  const money = api.v1.invoicing.count.useQuery({ unpaidOnly: true }, opts);

  return {
    jobs: jobs.data?.total,
    customers: customers.data?.total,
    money: money.data?.total,
  };
}
