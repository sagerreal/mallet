"use client";

/**
 * app/(office)/composer/measured-surfaces-panel.tsx
 *
 * "Measured surfaces" — the composer's own door to a job's measurements. Sits
 * ABOVE the quote card: every capture on the job (scanned/manual rooms + traced
 * site surfaces) as a row with its key figures and a per-surface "Seed lines"
 * action, plus "+ Trace from satellite" opening the existing tracer sheet. The
 * job modal's measure/site blocks remain the second door — this panel exists so
 * an office standing on New quote can SEE the measurements and act on them.
 *
 * Visibility (derive logic in measured-surfaces.ts, unit-tested there):
 *   - org toggle `measurementEstimating` off → nothing renders
 *   - no job context (no ?job= and the picked customer has no open jobs) → nothing
 *   - job context but measurements still loading → nothing yet (never an empty shell)
 *   - fetch FAILED with nothing cached → LoadFailed ("Couldn't load your
 *     measurements"), never a panel pretending nothing exists
 *
 * Job context: ?job= pins the job (the Build-the-price boot). Otherwise the
 * picked customer's open jobs are the candidates; when 2+ of them have captures
 * a compact in-flow selector row (segmented control — no popover) picks one.
 *
 * Seeding: per-surface via v1.quoting.buildFromMeasurements with the additive
 * `sourceNames` filter — only that capture's lines are appended (the page's
 * appendMeasurementLines). Seed-once: the button flips to "Seeded" and disables
 * after success; a ?job= boot already seeded the WHOLE job, so every row starts
 * seeded there. An empty per-surface seed (no priced service for its kinds)
 * surfaces the reason inline instead of silently doing nothing.
 *
 * The tracer round-trip needs no reload: SiteTraceNew persists through the
 * store's addTracedSite, which writes sitesByJob optimistically — this panel
 * reads that same slice, so a saved trace appears the moment the modal closes.
 */

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { useJobRooms } from "@/features/measurements/use-job-rooms";
import { useJobSites } from "@/features/measurements/use-job-sites";
import { LoadFailed } from "@/components/shared/load-failed";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Row } from "@/components/ui/row";
import type { MeasurementSeedLine } from "./composer-state";
import {
  candidateJobsForLead,
  jobCaptureCount,
  panelJobOptions,
  panelRows,
  resolvePanelJob,
  seedKey,
  type MeasuredRow,
} from "./measured-surfaces";

export interface MeasuredSurfacesPanelProps {
  /** ?job= from the URL — pins the panel to that job. */
  paramJobId: string | null;
  /** The composer's current lead (picked customer or ?lead=/?job= boot). */
  leadId: string | null;
  /** True once the ?job= boot seeded the whole job — every row starts "Seeded". */
  wholeJobSeeded: boolean;
  /** Append one surface's seed lines to the composer (cents on the wire). */
  onSeedLines: (lines: MeasurementSeedLine[]) => void;
}

/** Hydrates one candidate job's measurements into the store; renders nothing. */
function JobMeasurementsProbe({ jobId }: { jobId: string }) {
  useJobRooms(jobId);
  useJobSites(jobId);
  return null;
}

export function MeasuredSurfacesPanel({
  paramJobId,
  leadId,
  wholeJobSeeded,
  onSeedLines,
}: MeasuredSurfacesPanelProps) {
  const enabled = useAppStore((s) => s.toggles.measurementEstimating);
  const jobs = useAppStore((s) => s.jobs);
  const roomsByJob = useAppStore((s) => s.roomsByJob);
  const sitesByJob = useAppStore((s) => s.sitesByJob);
  const openModal = useOpenModal();
  const utils = api.useUtils();

  const [chosenJobId, setChosenJobId] = useState<string | null>(null);
  const [seededKeys, setSeededKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [seedingName, setSeedingName] = useState<string | null>(null);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const candidates = candidateJobsForLead(jobs, leadId);
  const countFor = (id: string) => jobCaptureCount(roomsByJob[id], sitesByJob[id]);
  const jobId = resolvePanelJob({ paramJobId, chosenJobId, candidates, countFor });

  // Hooks run unconditionally (null disables the queries) — the early returns
  // below must come after them.
  const roomsQuery = useJobRooms(enabled ? jobId : null);
  const sitesQuery = useJobSites(enabled ? jobId : null);

  if (!enabled || !jobId) return null;

  const rooms = roomsByJob[jobId];
  const sites = sitesByJob[jobId];
  // A failed fetch with nothing cached must never read as "nothing measured".
  const loadFailed =
    (roomsQuery.isError && rooms === undefined) || (sitesQuery.isError && sites === undefined);
  // Still hydrating (no error, a slice not seeded yet) — render nothing rather
  // than an empty shell that pops rows in a beat later.
  if (!loadFailed && (rooms === undefined || sites === undefined)) {
    return <ProbesOnly candidates={candidates.map((j) => j.id)} selectedJobId={jobId} />;
  }

  const rows = panelRows(rooms ?? [], sites ?? []);
  const options = panelJobOptions(candidates, countFor);
  const showSelector = !paramJobId && options.length >= 2;
  const jobSeeded = wholeJobSeeded && jobId === paramJobId;

  async function seedSurface(name: string) {
    if (!jobId || seedingName !== null) return;
    const key = seedKey(jobId, name);
    if (jobSeeded || seededKeys.has(key)) return;
    setSeedError(null);
    setSeedNotice(null);
    setSeedingName(name);
    try {
      const built = await utils.v1.quoting.buildFromMeasurements.fetch({
        jobId,
        sourceNames: [name],
      });
      if (built.seedLines.length === 0) {
        // Not a failure, but not a silent no-op either: nothing on this capture
        // is priceable (its kinds have no active priced service).
        setSeedNotice(
          `No priced service covers ${name} yet — add one in the pricebook, then seed again.`,
        );
      } else {
        onSeedLines(built.seedLines.map((l) => ({ ...l })));
        setSeededKeys((prev) => new Set([...prev, key]));
      }
    } catch {
      setSeedError(`Couldn't seed lines from ${name} — check your connection and try again.`);
    } finally {
      setSeedingName(null);
    }
  }

  return (
    <Card style={{ marginTop: "var(--space-5)" }}>
      <ProbesOnly candidates={candidates.map((j) => j.id)} selectedJobId={jobId} />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: "0" }}>Measured surfaces</h3>
        <Button size="sm" onClick={() => openModal(MODAL.SITE_TRACER, { jobId })}>
          + Trace from satellite
        </Button>
      </div>

      {showSelector && (
        <div className="seg" role="group" aria-label="Measured job" style={{ marginTop: "var(--space-3)" }}>
          {options.map((o) => (
            <button
              key={o.jobId}
              type="button"
              aria-pressed={o.jobId === jobId}
              onClick={() => setChosenJobId(o.jobId)}
            >
              {o.title || "Untitled job"}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: "var(--space-3)" }}>
        {loadFailed ? (
          <LoadFailed
            noun="measurements"
            onRetry={() => {
              void roomsQuery.refetch();
              void sitesQuery.refetch();
            }}
            retrying={roomsQuery.isRefetching || sitesQuery.isRefetching}
          />
        ) : (
          <SurfaceRows
            rows={rows}
            isSeeded={(name) => jobSeeded || seededKeys.has(seedKey(jobId, name))}
            seedingName={seedingName}
            onSeed={(name) => void seedSurface(name)}
          />
        )}
      </div>

      {seedNotice && (
        <p style={{ fontSize: "var(--type-base)", color: "var(--ink-3)", margin: "var(--space-2) 0 0" }}>
          {seedNotice}
        </p>
      )}
      {seedError && (
        <p
          role="alert"
          style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-2) 0 0" }}
        >
          {seedError}
        </p>
      )}
    </Card>
  );
}

/** The capture rows (or the honest empty line) with their per-surface seed action. */
function SurfaceRows({
  rows,
  isSeeded,
  seedingName,
  onSeed,
}: {
  rows: readonly MeasuredRow[];
  isSeeded: (name: string) => boolean;
  seedingName: string | null;
  onSeed: (name: string) => void;
}) {
  if (rows.length === 0) {
    return <div className="empty-att">Nothing measured on this job yet.</div>;
  }
  return (
    <>
      {rows.map((row) => {
        const seeded = isSeeded(row.name);
        return (
          <Row
            key={`${row.kind}:${row.name}`}
            label={row.name}
            value={row.summary}
            trailing={
              <Button
                size="sm"
                disabled={seeded || seedingName !== null}
                onClick={() => onSeed(row.name)}
              >
                {seeded ? "Seeded" : seedingName === row.name ? "Seeding…" : "Seed lines"}
              </Button>
            }
          />
        );
      })}
    </>
  );
}

/**
 * Hydration probes for every candidate job — capture counts drive the job
 * selector, so each candidate's measurements load in the background. The
 * selected job's own queries live in the panel (probes dedupe via react-query
 * + the hooks' seed-once guard).
 */
function ProbesOnly({
  candidates,
  selectedJobId,
}: {
  candidates: readonly string[];
  selectedJobId: string;
}) {
  return (
    <>
      {candidates
        .filter((id) => id !== selectedJobId)
        .slice(0, 8)
        .map((id) => (
          <JobMeasurementsProbe key={id} jobId={id} />
        ))}
    </>
  );
}
