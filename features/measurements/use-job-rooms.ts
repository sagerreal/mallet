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
 *
 * SEED-ONCE-PER-SESSION, not seed-on-every-mount: the job modal unmounts/remounts each
 * time it's closed and reopened, and react-query keeps serving its cached (possibly
 * stale, per `staleTime`) response on remount. If we blindly re-seeded the store from
 * that response every mount, reopening the modal after editing a room would overwrite
 * the just-persisted edit with the stale cached list — and worse, could wipe an
 * in-flight optimistic row whose reconcile callback would then have nothing to update
 * (a silent no-op data-loss path). So the store, once seeded for a given job, is the
 * source of truth for the rest of the session: `shouldSeedJobRooms` only allows the
 * seed when the slice has NEVER been populated for that job (`roomsByJob[jobId] ===
 * undefined`), not merely when it's empty. A later explicit "refresh" affordance can
 * force a reseed by calling `setJobRooms` directly — this hook intentionally does not.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { roomCaptureDtoToStore } from "@/lib/store/measurements-mapper";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import type { RoomCard } from "@/lib/store/types";

/**
 * Pure guard: should a fetched list be written into the store? Only on first load for
 * this job — `current === undefined` means the slice has never been seeded for this
 * jobId (as opposed to `[]`, which means it WAS seeded and genuinely has no rooms).
 * Extracted so the seed-once behavior is unit-testable without mounting the hook.
 */
export function shouldSeedJobRooms(current: readonly RoomCard[] | undefined): boolean {
  return current === undefined;
}

export function useJobRooms(jobId: string | null | undefined) {
  const setJobRooms = useAppStore((s) => s.setJobRooms);
  const existing = useAppStore((s) => (jobId ? s.roomsByJob[jobId] : undefined));
  const query = api.v1.measurements.list.useQuery(
    { jobId: jobId ?? "" },
    { refetchOnWindowFocus: false, enabled: !!jobId, staleTime: HYDRATOR_STALE_MS },
  );

  useEffect(() => {
    if (!jobId || !query.data) return;
    if (!shouldSeedJobRooms(existing)) return;
    setJobRooms(jobId, query.data.map(roomCaptureDtoToStore));
  }, [jobId, query.data, existing, setJobRooms]);

  return query;
}
