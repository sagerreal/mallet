"use client";

/**
 * features/checklists/checklists-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.checklists.list and writes
 * the result into the Zustand store so StandardsModalContent, the settings
 * Pipeline section, and the job-modal attach picker all read real DB templates.
 *
 * refetchOnWindowFocus: false — checklists have optimistic mutations
 * (addChecklist / addChecklistItem / etc.) that a focus-triggered refetch could
 * overwrite mid-flight. Matches CompaniesHydrator / LeadsHydrator.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Checklist } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";

type ChecklistDTO = RouterOutputs["v1"]["checklists"]["list"]["items"][number];

export function toStoreChecklist(dto: ChecklistDTO): Checklist {
  return {
    id: dto.id,
    name: dto.name,
    trade: dto.trade,
    stage: dto.stage,
    match: [...dto.match],
    items: dto.items.map((it) => ({
      id: it.id,
      text: it.text,
      type: it.type,
      required: it.required,
      position: it.position,
    })),
  };
}

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
    transform: toStoreChecklist,
    setSlice: setChecklists,
    label: "checklists",
  });

  return null;
}
