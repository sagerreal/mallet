"use client";

/**
 * features/timesheets/timesheets-hydrator.tsx
 * Mounts in the OFFICE layout only (app/(office)/layout.tsx). Subscribes to
 * trpc.v1.timesheets.list and writes the result into the Zustand store, which is
 * what the office Timesheets panel reads.
 *
 * It is deliberately NOT mounted in the field layout: My Hours queries
 * v1.timesheets.list directly and owns its own writes, so a second hydrator
 * there would fill a store nothing on that surface reads.
 *
 * The backend scopes the list by caller — a tech gets only their own entries
 * (techUserId override in the router), owner/office get all org entries. No
 * client-side filter needed.
 *
 * refetchOnWindowFocus: false — same clobber-avoidance as other hydrators.
 * Optimistic mutations in timesheets-slice reconcile with the server immediately
 * on success; a focus-triggered clobber would race against pending writes.
 *
 * DTO type is derived from the router via RouterOutputs so it cannot drift
 * from the backend schema.
 */

import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";
import { dtoToTimeEntry } from "@/lib/store/dto-mapper";

export function TimesheetsHydrator() {
  const setTimeEntries = useAppStore((s) => s.setTimeEntries);
  const { data, isError, error } = api.v1.timesheets.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: dtoToTimeEntry,
    setSlice: setTimeEntries,
    label: "timesheets",
  });

  return null;
}
