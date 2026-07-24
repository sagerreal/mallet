"use client";

/**
 * features/a2p/a2p-hydrator.tsx
 * Subscribes to trpc.v1.a2p.getStatus and writes the org's A2P 10DLC registration
 * status view into the Zustand store. Mirrors settings-hydrator.tsx: getStatus
 * returns a single snapshot object (not a paginated list), so this maps the DTO
 * directly and calls setA2pStatus rather than going through useStoreHydrator
 * (which is list-shaped — see checklists/leads/jobs hydrators).
 *
 * refetchOnWindowFocus: false — there's no client-side mutation on this slice to
 * race with (registration is driven by its own onboarding-flow mutations, not a
 * store action here), but a focus refetch clobbering an in-progress registration
 * poll would still be surprising; matches every other hydrator's convention.
 *
 * Where this mounts in the app tree is Task 13's concern.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function A2pHydrator() {
  const setA2pStatus = useAppStore((s) => s.setA2pStatus);
  const { data, isError, error } = api.v1.a2p.getStatus.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (isError) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.error("[hydrator:a2p] load failed", error);
      }
      return;
    }
    if (!data) return;
    setA2pStatus(data);
  }, [data, isError, error, setA2pStatus]);

  return null;
}
