"use client";

/**
 * features/tasks/tasks-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.tasks.list and
 * writes the result into the Zustand store so the Tasks page, lead-modal
 * Tasks card, sidebar badge, and counter all see real DB data.
 *
 * refetchOnWindowFocus: false — same clobber-avoidance as JobsHydrator.
 * Optimistic mutations in leads-slice reconcile with the server immediately
 * on success; a focus-triggered clobber would race against that and lose
 * pending writes.
 *
 * DTO type is derived from the router via RouterOutputs — it can't drift
 * from the backend schema.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Task } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";

type TaskDTO = RouterOutputs["v1"]["tasks"]["list"]["items"][number];

function toStoreTask(dto: TaskDTO): Task {
  return {
    id: dto.id,
    t: dto.text,
    due: dto.dueDate,
    leadId: dto.leadId,
    done: dto.done,
  };
}

export function TasksHydrator() {
  const setTasks = useAppStore((s) => s.setTasks);
  const { data, isError, error } = api.v1.tasks.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: toStoreTask,
    setSlice: setTasks,
    label: "tasks",
  });

  return null;
}
