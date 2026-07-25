"use client";

/**
 * features/field/field-jobs-hydrator.tsx
 * Mounts in the (field) layout. Subscribes to v1.field.myDay (anyRole,
 * assignee-scoped) and writes the result into the Zustand jobs slice — the
 * field surface's counterpart of the office JobsHydrator (which hydrates from
 * the ownerOrOffice v1.jobs.list and therefore FORBIDDENs a tech).
 *
 * Without this, store.jobs is empty on a tech's device and the tech-job-modal
 * (checklist check-offs, found work) has nothing to read. The store IS the
 * modal's data source, so myDay hydrates it rather than growing parallel state.
 *
 * TECH-ONLY: myDay is the CALLER's personal subset. An owner/office user on a
 * field page keeps the office hydrator's full jobs list — replacing it with
 * their own assigned-jobs subset would clobber every shared shell component
 * (command bar, modals) until they navigate back. Role gate fails closed:
 * no hydration until v1.identity.me confirms the tech role.
 *
 * The my-day page subscribes to the same query key, so its refetches after
 * start/complete re-run this sync automatically.
 *
 * IDLE PREFETCH: once myDay settles we warm the sibling tabs' query caches in
 * an idle callback. My hours uses a 60-second staleTime, so we match that in
 * the prefetch options — a tab switch within a normal session hits the cache
 * and the page renders without a skeleton flash.  Messages uses 15 s; we pass
 * undefined input (matches the page's query key exactly).
 */

import { useMemo, useEffect, useRef } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import type { Job, Lead } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { dtoJobToStoreJob, type JobDTO } from "@/lib/store/dto-mapper";
import { myHoursListInput, MY_HOURS_STALE_MS } from "./my-hours-input";

type MyDayItem = RouterOutputs["v1"]["field"]["myDay"]["items"][number];

// Cast: the myDay item (jobSummaryDTO shape) is structurally compatible with the
// fields dtoJobToStoreJob actually reads — same pattern as jobs-slice adoptJob.
const toStoreJob = (item: MyDayItem): Job => dtoJobToStoreJob(item as unknown as JobDTO);

// The field surface knows a customer only as "who this job is for and the number to call" — it has
// no lead list and no lead detail. Enough of a Lead to name them in the call bar and pass the
// has-a-phone gate; the rest of the shape is empty because the field simply does not have it.
const toStoreLead = (c: { id: string; name: string; phone: string | null }): Lead => ({
  id: c.id,
  name: c.name,
  phone: c.phone ?? "",
  source: "",
  stage: "",
  age: 0,
  job: "",
  last: "",
});

export function FieldJobsHydrator() {
  const setJobs = useAppStore((s) => s.setJobs);
  const setLeads = useAppStore((s) => s.setLeads);
  const me = useMe();
  const isTech = me.data?.role === "tech";
  const { data, isError, error } = api.v1.field.myDay.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const utils = api.useUtils();
  const prefetchedRef = useRef(false);

  // Once myDay data has settled, warm the sibling tabs' query caches during an
  // idle moment.  One-per-mount guard prevents repeated scheduling on re-renders.
  //
  // staleTime alignment:
  //   my-hours → 60_000 ms (page passes staleTime: 60_000; we match it so the
  //              query isn't considered stale when the page mounts into the cache)
  //   messages → 15_000 ms (page's staleTime — prefetch honours the same window)
  useEffect(() => {
    if (!data || prefetchedRef.current) return;
    prefetchedRef.current = true;

    function runPrefetch(): void {
      // myHoursListInput is the SAME builder the page uses — the keys cannot drift.
      void utils.v1.timesheets.list.prefetch(myHoursListInput(), { staleTime: MY_HOURS_STALE_MS });
      void utils.v1.messaging.listConversations.prefetch(undefined, { staleTime: 15_000 });
    }

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const w = window as Window & {
        requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback: (handle: number) => void;
      };
      const handle = w.requestIdleCallback(runPrefetch, { timeout: 2_000 });
      return () => w.cancelIdleCallback(handle);
    }
    const id = setTimeout(runPrefetch, 200);
    return () => clearTimeout(id);
  }, [data, utils]);

  // myDay is not paginated — adapt to the hydrator hook's { items, nextCursor }
  // contract. Memoized so the sync effect only re-runs when the data changes.
  // Undefined for non-tech (or not-yet-known) roles = the hydrator hook no-ops.
  const page = useMemo(
    () => (isTech && data ? { items: data.items, nextCursor: null } : undefined),
    [isTech, data],
  );

  useStoreHydrator({
    data: page,
    isError,
    error,
    transform: toStoreJob,
    setSlice: setJobs,
    label: "field-jobs",
  });

  // TECH-ONLY, for the same reason the jobs hydration is: an owner/office user on a field page
  // keeps the office LeadsHydrator's full customer list, and replacing it with the handful behind
  // their own jobs would blank out every office surface until they navigated back.
  const customers = useMemo(
    () => (isTech && data ? { items: data.customers, nextCursor: null } : undefined),
    [isTech, data],
  );

  useStoreHydrator({
    data: customers,
    isError,
    error,
    transform: toStoreLead,
    setSlice: setLeads,
    label: "field-customers",
  });

  return null;
}
