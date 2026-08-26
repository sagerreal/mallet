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
import { backendStageToStore, dtoCardToStore } from "@/lib/store/dto-mapper";

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
    // Defaulted, not spread blind: an unconditional [...dto.tags] THREW on any response
    // without the key (a cached page from a previous deploy, or a partial fixture), and the
    // throw happens inside the adopt effect — it blanks the whole customer sheet rather than
    // losing one field. Mirrors the customFields/notes/address guards below.
    tags: dto.tags ? [...dto.tags] : [],
    stage: backendStageToStore(dto.stage),
    ...(dto.group ? { group: dto.group } : {}),
    age: daysAgo(dto.createdAt),
    job: "",
    last: "",
    lastActivityAt: dto.updatedAt,
    unread: dto.unread,
    email: dto.email ?? undefined,
    value: dto.value.cents / 100, // DTO is cents; store Lead.value is dollars.
    companyId: dto.companyId ?? undefined,
    role: dto.role ?? undefined,
    customFields: dto.customFields ?? undefined,
    notes: dto.notes ?? undefined,
    address: dto.address ?? undefined,
    pipelineStageId: dto.pipelineStageId ?? undefined,
    // The key is set only when a card exists, so adoptLead's `{ ...prior, ...lead }` merge from
    // a card-less mutation DTO cannot erase a card the list already delivered.
    ...(dto.card ? { card: dtoCardToStore(dto.card) } : {}),
    acts: [],
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
