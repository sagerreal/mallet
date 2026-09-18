"use client";

/**
 * features/pricebook/assemblies-hydrator.tsx
 * Mounts in the office layout. Subscribes to v1.assemblies.list and writes the
 * result into the Zustand store so the composer's Measure panel (assembly
 * seeding) and the pricebook's Assemblies card read one hydrated book. The
 * list is read-time-merged server-side (shipped catalog + org overrides), so
 * even a zero-row org hydrates the full default catalog.
 *
 * refetchOnWindowFocus: false — dial edits are optimistic mutations a
 * focus-triggered refetch could overwrite mid-flight (PricebookHydrator's
 * rule, same reason).
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { assemblyDtoToStore } from "@/lib/store/assemblies-mapper";

export function AssembliesHydrator() {
  const setAssemblies = useAppStore((s) => s.setAssemblies);

  const assemblies = api.v1.assemblies.list.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (assemblies.isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:assemblies] list load failed", assemblies.error);
      }
      return;
    }
    if (!assemblies.data) return;
    setAssemblies(assemblies.data.map(assemblyDtoToStore));
  }, [assemblies.data, assemblies.isError, assemblies.error, setAssemblies]);

  return null;
}
