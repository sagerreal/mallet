/**
 * components/modals/job-site-block.tsx
 * The job modal's "Site measurements" block — outdoor surfaces (driveways,
 * patios, roof facets) traced from satellite imagery. Mirrors
 * job-measure-block.tsx: tap rows inside the accordion body plus a trailing
 * "+ Trace from satellite" that drills into the tracer sheet (pushed onto the
 * modal back-stack, so closing it returns here).
 *
 * Surfaces hydrate lazily via useJobSites(jobId); a FAILED list fetch renders
 * LoadFailed, never "no surfaces" (same predicate pairing as the rooms block).
 */

"use client";

import { useRouter } from "next/navigation";
import { useJobSites } from "@/features/measurements/use-job-sites";
import { usePushModal, useCloseModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { shouldShowLoadFailed } from "@/lib/first-run";
import { LoadFailed } from "@/components/shared/load-failed";
import { Row } from "@/components/ui/row";
import { surfaceSummary } from "@/lib/measure/aerial-geometry";
import type { SiteCard } from "@/lib/store/types";

// Stable fallback OUTSIDE the selector — a fresh [] per getSnapshot infinite-loops
// useSyncExternalStore (same trap documented in job-measure-block.tsx).
const EMPTY_SITES: readonly SiteCard[] = [];

export function JobSiteBlock({ jobId }: { jobId: string }) {
  const query = useJobSites(jobId);
  const sites = useAppStore((s) => s.sitesByJob[jobId]) ?? EMPTY_SITES;
  const pushModal = usePushModal();
  const close = useCloseModal();
  const router = useRouter();

  // "Build the price" — same navigate-away pattern as job-measure-block.tsx: close the modal
  // stack, route to the composer, which seeds itself from v1.quoting.buildFromMeasurements
  // (rooms AND traced surfaces) on mount.
  function buildThePrice() {
    close();
    router.push(`/composer?job=${jobId}`);
  }

  const loadFailed = shouldShowLoadFailed({
    isFetched: query.isFetched,
    isError: query.isError,
    count: sites.length,
  });

  return (
    <div>
      {loadFailed ? (
        <LoadFailed
          noun="surfaces"
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      ) : (
        <>
          {sites.map((site) => (
            <Row
              key={site.id}
              label={site.name}
              value={surfaceSummary(site)}
              onClick={() => pushModal(MODAL.SITE_TRACER, { captureId: site.id, jobId })}
            />
          ))}

          {sites.length === 0 && (
            <div className="empty-att" style={{ marginBottom: "var(--space-2)" }}>
              No surfaces traced yet.
            </div>
          )}

          {sites.length > 0 && (
            <button
              type="button"
              className="btn sm"
              style={{ marginBottom: "var(--space-2)" }}
              onClick={buildThePrice}
            >
              Build the price
            </button>
          )}
        </>
      )}

      <button
        type="button"
        className="btn sm"
        style={{ marginTop: "var(--space-2)" }}
        onClick={() => pushModal(MODAL.SITE_TRACER, { jobId })}
      >
        + Trace from satellite
      </button>
    </div>
  );
}
