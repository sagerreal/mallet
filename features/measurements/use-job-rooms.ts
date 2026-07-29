"use client";

/**
 * features/measurements/use-job-rooms.ts
 * Lazy, job-scoped hydration for room captures — call from the job modal panel
 * that shows measurements, NOT from a global hydrator mounted in the office layout.
 *
 * Every other domain-list hydrator in this app (ChecklistsHydrator, LeadsHydrator,
 * JobsHydrator, …) is registered in hydrator-config.ts and fetches its WHOLE org-scoped
 * list once, up front. That works because those lists are bounded by the org: a shop
 * has dozens of checklists, jobs, leads. Room captures are bounded by the JOB instead —
 * fetching every org's every job's every scanned room on every page load would pull an
 * unbounded, ever-growing payload for data almost no open surface needs at once. So
 * measurements hydrate on demand, scoped to the one job whose modal is actually open,
 * mirroring how useJob(jobId) (features/jobs/hooks.ts) fetches a single job's detail
 * lazily rather than folding it into the org-wide jobs list hydrator.
 *
 * refetchOnWindowFocus: false — matches every other hydrator: rooms have optimistic
 * mutations (addManualRoom / overrideQuantity / …) that a focus-triggered refetch could
 * clobber mid-flight.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { roomCaptureDtoToStore } from "@/lib/store/measurements-mapper";

export function useJobRooms(jobId: string | null | undefined) {
  const setJobRooms = useAppStore((s) => s.setJobRooms);
  const query = api.v1.measurements.list.useQuery(
    { jobId: jobId ?? "" },
    { refetchOnWindowFocus: false, enabled: !!jobId },
  );

  useEffect(() => {
    if (!jobId || !query.data) return;
    setJobRooms(jobId, query.data.map(roomCaptureDtoToStore));
  }, [jobId, query.data, setJobRooms]);

  return query;
}
