"use client";

/**
 * features/checklists/checklists-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.checklists.list and writes
 * the result into the Zustand store so the job-modal checklist panel and the
 * new-job picker read real DB checklists.
 *
 * refetchOnWindowFocus: false — checklists have optimistic mutations
 * (addChecklist / deleteChecklist) that a focus-triggered refetch could
 * overwrite mid-flight. Matches CompaniesHydrator / LeadsHydrator.
 */

import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";
import { checklistDtoToStore } from "@/lib/store/checklists-mapper";

// Re-export under the original name so existing test imports keep resolving.
export { checklistDtoToStore as toStoreChecklist } from "@/lib/store/checklists-mapper";

export function ChecklistsHydrator() {
  const setChecklists = useAppStore((s) => s.setChecklists);
  const { data, isError, error } = api.v1.checklists.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: checklistDtoToStore,
    setSlice: setChecklists,
    label: "checklists",
  });

  return null;
}
