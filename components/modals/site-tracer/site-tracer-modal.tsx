/**
 * components/modals/site-tracer/site-tracer-modal.tsx
 * Entry point for the aerial tracer sheet. Opened from the composer's Measure
 * section (satellite measurement is an ESTIMATING feature — the entry lives on
 * the quote page) with one of:
 *   { held: true, address?, existingNames?, onSaveHeld }
 *                         → trace a new surface with NO job: the header carries
 *                           an address input, the finished trace is handed back
 *                           to the composer as a HeldTrace (quote-held, not DB)
 *   { jobId }             → trace a new surface onto a job's site captures
 *   { jobId, captureId }  → view/edit a saved capture
 *
 * Site captures hydrate lazily via useJobSites; a failed list fetch renders
 * LoadFailed rather than pretending the capture vanished.
 */

"use client";

import { useActiveModal, useAppStore } from "@/lib/store/app-store";
import { useJobSites } from "@/features/measurements/use-job-sites";
import { shouldShowLoadFailed } from "@/lib/first-run";
import { LoadFailed } from "@/components/shared/load-failed";
import { ModalLoading } from "../modal-loading";
import { SiteTraceNew } from "./site-trace-new";
import { SiteCaptureView } from "./site-capture-view";
import { heldTracerParams } from "./held-tracer-params";
import type { SiteCard } from "@/lib/store/types";

const EMPTY_SITES: readonly SiteCard[] = [];

export function SiteTracerModalContent() {
  const activeModal = useActiveModal();
  const held = heldTracerParams(activeModal?.params);
  const jobId = activeModal?.params?.jobId as string | undefined;
  const captureId = activeModal?.params?.captureId as string | undefined;

  // Hooks run unconditionally — held mode just disables the job-sites query.
  const query = useJobSites(held ? undefined : jobId);
  const sites = useAppStore((s) => (jobId ? s.sitesByJob[jobId] : undefined)) ?? EMPTY_SITES;
  const job = useAppStore((s) => (jobId ? s.jobs.find((j) => j.id === jobId) : undefined));

  if (held) {
    return (
      <SiteTraceNew
        target={{ kind: "held", initialAddress: held.address, onSave: held.onSaveHeld }}
        existingNames={held.existingNames}
      />
    );
  }

  if (!jobId) {
    return (
      <div>
        <div className="sheet-head">
          <h2>Site measurements</h2>
        </div>
        <p className="muted">This surface is no longer available.</p>
      </div>
    );
  }

  if (captureId) {
    const site = sites.find((s) => s.id === captureId);
    if (site) return <SiteCaptureView site={site} jobTitle={job?.title} />;

    const loadFailed = shouldShowLoadFailed({
      isFetched: query.isFetched,
      isError: query.isError,
      count: sites.length,
    });
    if (loadFailed) {
      return (
        <div>
          <div className="sheet-head">
            <h2>Site measurements</h2>
          </div>
          <LoadFailed
            noun="surfaces"
            onRetry={() => void query.refetch()}
            retrying={query.isRefetching}
          />
        </div>
      );
    }
    if (!query.isFetched) return <ModalLoading size="lg" />;
    return (
      <div>
        <div className="sheet-head">
          <h2>Site measurements</h2>
        </div>
        <p className="muted">This surface is no longer available — it may have been removed.</p>
      </div>
    );
  }

  return (
    <SiteTraceNew
      target={{ kind: "job", jobId, jobTitle: job?.title, address: job?.addr?.trim() ?? "" }}
      existingNames={sites.map((s) => s.name)}
    />
  );
}
