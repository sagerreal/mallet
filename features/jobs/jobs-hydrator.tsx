"use client";

/**
 * features/jobs/jobs-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.jobs.list and
 * writes the result into the Zustand store so every existing consumer
 * (schedule board, money ledger, jobs list, etc.) sees real DB data.
 *
 * When the query cache is invalidated (after create / update / complete),
 * React Query refetches automatically and this effect re-syncs the store.
 *
 * DTO type is derived from the router via RouterOutputs — it can't drift
 * from the backend schema.
 *
 * Mapping helpers live in lib/store/dto-mapper.ts so the jobs-slice can
 * reuse them for optimistic-reconcile without importing React code.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Job } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT, JOB_ORIGIN } from "@/lib/store/hydrator-config";
import {
  hhmmToHour,
  hoursBetween,
  toStoreVisit,
  mapExecution,
  dtoChecklistToStore,
} from "@/lib/store/dto-mapper";

// Re-export the pure time helpers so existing unit tests importing from here
// continue to work without change.
export { hhmmToHour, hoursBetween };

type JobSummaryDTO = RouterOutputs["v1"]["jobs"]["list"]["items"][number];

// ---------------------------------------------------------------------------
// Status mapping (list DTO only — full jobDTO uses dtoJobToStoreJob)
// ---------------------------------------------------------------------------

const BACKEND_JOB_STATUS = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "in_progress",
  COMPLETE: "complete",
  CANCELED: "canceled",
} as const;

const BACKEND_VISIT_STATUS_CANCELED = "canceled";

function toStoreStatus(s: string): string {
  if (s === BACKEND_JOB_STATUS.COMPLETE || s === BACKEND_JOB_STATUS.CANCELED) return "done";
  if (s === BACKEND_JOB_STATUS.SCHEDULED || s === BACKEND_JOB_STATUS.IN_PROGRESS) return "scheduled";
  return "unscheduled";
}

function isPlacedVisit(v: { date: string | null; techId: string | null; start: number | null }): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

function recalcStatus(visits: ReturnType<typeof toStoreVisit>[]): string {
  const placed = visits.filter(isPlacedVisit);
  if (!placed.length) return "unscheduled";
  if (placed.every((v) => v.status === "done")) return "done";
  return "scheduled";
}

// ---------------------------------------------------------------------------
// DTO → store mapper for the summary list shape
// ---------------------------------------------------------------------------

function toStoreJob(dto: JobSummaryDTO): Job {
  // Filter out canceled visits before mapping — they are not shown on the board.
  const activeVisitDTOs = dto.visits.filter(
    (v) => v.status !== BACKEND_VISIT_STATUS_CANCELED,
  );
  const visits = activeVisitDTOs.map(toStoreVisit);

  // Prefer recalc when visits exist; fall back to the coarse backend status.
  // When there are no active visits AND the backend status is "scheduled", remap to
  // "unscheduled" — a zero-visit job has not been slotted yet (e.g. freshly created
  // from an accepted quote via CreateJobFromEstimateUseCase). Only "in_progress",
  // "complete", and "canceled" are preserved via the coarse fallback.
  const status = visits.length > 0
    ? recalcStatus(visits)
    : dto.status === BACKEND_JOB_STATUS.SCHEDULED
      ? "unscheduled"
      : toStoreStatus(dto.status);

  return {
    id: dto.id,
    leadId: dto.leadId,
    sourceEstimateId: dto.sourceEstimateId ?? null,
    svc: dto.svc ?? "service",
    origin: JOB_ORIGIN.DB,
    title: dto.title ?? "Job",
    addr: "",
    phone: "",
    status,
    archived: false,
    notes: dto.notes ?? "",
    checklist: dtoChecklistToStore(dto.checklist),
    requiredCerts: dto.requiredCerts ?? null,
    acts: [],
    visits,
    ...mapExecution(dto),
  };
}

export function JobsHydrator() {
  const setJobs = useAppStore((s) => s.setJobs);
  // reconcile-on-mutation-success keeps the store authoritative, so focus refetch would only clobber optimistic writes.
  const { data, isError, error } = api.v1.jobs.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: toStoreJob,
    setSlice: setJobs,
    label: "jobs",
  });

  return null;
}
