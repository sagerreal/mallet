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
 * The my-day page subscribes to the same query key, so its refetches after
 * start/complete re-run this sync automatically.
 */

import { useMemo } from "react";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Job } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { dtoJobToStoreJob, type JobDTO } from "@/lib/store/dto-mapper";

type MyDayItem = RouterOutputs["v1"]["field"]["myDay"]["items"][number];

// Cast: the myDay item (jobSummaryDTO shape) is structurally compatible with the
// fields dtoJobToStoreJob actually reads — same pattern as jobs-slice adoptJob.
const toStoreJob = (item: MyDayItem): Job => dtoJobToStoreJob(item as unknown as JobDTO);

export function FieldJobsHydrator() {
  const setJobs = useAppStore((s) => s.setJobs);
  const { data, isError, error } = api.v1.field.myDay.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  // myDay is not paginated — adapt to the hydrator hook's { items, nextCursor }
  // contract. Memoized so the sync effect only re-runs when the data changes.
  const page = useMemo(
    () => (data ? { items: data.items, nextCursor: null } : undefined),
    [data],
  );

  useStoreHydrator({
    data: page,
    isError,
    error,
    transform: toStoreJob,
    setSlice: setJobs,
    label: "field-jobs",
  });

  return null;
}
