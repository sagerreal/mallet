"use client";

/**
 * features/customers/leads-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.customers.list and
 * writes the result into the Zustand store so every existing consumer
 * (pipeline, tasks, dashboard, etc.) sees real DB data without changes.
 *
 * When the query cache is invalidated (after create / update / archive),
 * React Query refetches automatically and this effect re-syncs the store.
 *
 * DTO type is derived from the router via RouterOutputs — it can't drift
 * from the backend schema.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Lead } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";
import { backendStageToStore } from "@/lib/store/dto-mapper";

type LeadDTO = RouterOutputs["v1"]["customers"]["list"]["items"][number];

function daysAgo(isoDate: string): number {
  return Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
}

// Exported for the new-customer modal, which inserts a just-created lead into
// the store (the create mutation bypasses addLead, so the hydrator hasn't
// caught up yet when an estimate visit needs a store row to attach to).
export function toStoreLead(dto: LeadDTO): Lead {
  return {
    id: dto.id,
    name: dto.name,
    phone: dto.phone ?? "",
    source: dto.source ?? "",
    stage: backendStageToStore(dto.stage),
    age: daysAgo(dto.createdAt),
    job: "",
    last: "",
    unread: dto.unread,
    email: dto.email ?? undefined,
    value: dto.value.cents / 100, // DTO is cents; store Lead.value is dollars.
    companyId: dto.companyId ?? undefined,
    role: dto.role ?? undefined,
    notes: dto.notes ?? undefined,
    address: dto.address ?? undefined,
    acts: [],
    evisits: [],
    archived: false,
  };
}

export function LeadsHydrator() {
  const setLeads = useAppStore((s) => s.setLeads);
  const { data, isError, error } = api.v1.customers.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    // refetchOnWindowFocus: false — leads have optimistic mutations (moveLeadStage /
    // updateLead / addLead) that a focus-triggered refetch can overwrite mid-flight.
    // Matches jobs/estimates/invoices hydrators.
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: toStoreLead,
    setSlice: setLeads,
    label: "leads",
  });

  return null;
}
