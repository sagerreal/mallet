"use client";

/**
 * features/customers/companies-hydrator.tsx
 * Mounts in the office layout. Subscribes to trpc.v1.companies.list and
 * writes the result into the Zustand store so CompaniesView and
 * CompanyViewModal see real DB data.
 *
 * refetchOnWindowFocus: false — companies have optimistic mutations
 * (addCompany / updateCompany) that a focus-triggered refetch can overwrite
 * mid-flight. Matches the pattern in LeadsHydrator / TasksHydrator.
 *
 * DTO type is derived from the router via RouterOutputs — it can't drift
 * from the backend schema.
 */

import { api, type RouterOutputs } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import type { Company } from "@/lib/store/types";
import { useStoreHydrator } from "@/lib/store/use-store-hydrator";
import { HYDRATOR_STALE_MS, HYDRATOR_PAGE_LIMIT } from "@/lib/store/hydrator-config";

type CompanyDTO = RouterOutputs["v1"]["companies"]["list"]["items"][number];

function toStoreCompany(dto: CompanyDTO): Company {
  return {
    id: dto.id,
    name: dto.name,
    phone: dto.phone ?? "",
    email: dto.email ?? "",
    website: dto.website ?? undefined,
    address: dto.address ?? undefined,
    notes: dto.notes ?? undefined,
    // sites is client-local (deferred per spec) — always empty from server.
    sites: [],
    archived: false,
  };
}

export function CompaniesHydrator() {
  const setCompanies = useAppStore((s) => s.setCompanies);
  const { data, isError, error } = api.v1.companies.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  useStoreHydrator({
    data,
    isError,
    error,
    transform: toStoreCompany,
    setSlice: setCompanies,
    label: "companies",
  });

  return null;
}
