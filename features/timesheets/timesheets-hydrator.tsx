"use client";

/**
 * features/timesheets/timesheets-hydrator.tsx
 * Mounts in both the office layout and the field layout. Subscribes to
 * trpc.v1.timesheets.list and writes the result into the Zustand store so
 * the Timesheets panel (office) and My Hours page (field) both see real DB data.
 *
 * For a tech caller the backend auto-scopes the list to their own entries
 * (techUserId override in the router). For owner/office the list returns all
 * org entries. No client-side filter needed — the backend handles scoping.
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
