"use client";

/**
 * features/measurements/use-job-sites.ts
 * Lazy, job-scoped hydration for site captures (aerial takeoff) — the exact
 * sibling of use-job-rooms.ts, and for the same reasons: site captures are
 * bounded by the JOB, not the org, so they hydrate on demand when the job
 * modal's measurements surface opens rather than through the global hydrator.
 *
 * Same SEED-ONCE-PER-SESSION rule: once sitesByJob[jobId] has been populated
 * (even to []), the store is the source of truth — re-seeding from a stale
 * react-query cache on modal remount would clobber just-persisted edits.
 */

import { useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { siteCaptureDtoToStore } from "@/lib/store/measurements-mapper";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import type { SiteCard } from "@/lib/store/types";

/**
 * Pure guard: seed only when the slice has NEVER been populated for this job
 * (`undefined`, not `[]`). Extracted for unit testing, mirroring
 * shouldSeedJobRooms.
 */
export function shouldSeedJobSites(current: readonly SiteCard[] | undefined): boolean {
  return current === undefined;
}

export function useJobSites(jobId: string | null | undefined) {
  const setJobSites = useAppStore((s) => s.setJobSites);
  const existing = useAppStore((s) => (jobId ? s.sitesByJob[jobId] : undefined));
  const query = api.v1.measurements.siteList.useQuery(
    { jobId: jobId ?? "" },
    { refetchOnWindowFocus: false, enabled: !!jobId, staleTime: HYDRATOR_STALE_MS },
  );

  useEffect(() => {
    if (!jobId || !query.data) return;
    if (!shouldSeedJobSites(existing)) return;
    setJobSites(jobId, query.data.map(siteCaptureDtoToStore));
  }, [jobId, query.data, existing, setJobSites]);

  return query;
}
