"use client";

/**
 * app/(office)/composer/measured-surfaces-panel.tsx
 *
 * "Measure" — satellite measurement's point of entry, ON THE QUOTE PAGE
 * (founder's rule: this is an estimating feature; it needs no customer and no
 * job first). Sits above the quote card. When the org toggle
 * `measurementEstimating` is on the section ALWAYS renders:
 *
 *   - "Measure from satellite" opens the tracer in HELD mode — an address box
 *     in its header finds the property (prefilled from the picked customer's
 *     address when there is one), and the finished trace comes back as a
 *     HeldTrace on the composer state, not a DB row. Seeding a held row is
 *     pure client math (held-trace-seed.ts — proven equal to the server's).
 *   - a picked customer's measured JOBS still show their capture rows (rooms +
 *     traced sites) exactly as before: per-surface "Seed lines" via
 *     v1.quoting.buildFromMeasurements with the sourceNames filter, the job
 *     selector when 2+ jobs have captures, LoadFailed on a dead fetch. Site
 *     rows open the saved capture (the tracer's view mode); room rows open the
 *     room card (rename / confirm / override quantities / re-scan) — this
 *     panel is the office's door to ALL measurements now that the job modal's
 *     rows are gone (the tech field Quote tab keeps its scan row).
 *   - "+ Add a room" (and "Scan room" when the native scanner is available)
 *     live here too, for the picked customer. Rooms anchor to jobs in the DB —
 *     room scans ingest server-first (unlike traces, which are pure client
 *     geometry and can be HELD on the quote), so a customer with no job yet
 *     gets an estimate job created silently on the first add/scan.
 *
 * Seed-once: a surface's button flips to "Seeded" and disables after success
 * (a ?job= boot already seeded the WHOLE job, so its rows start seeded). An
 * empty seed (no priced service for the kinds) surfaces the reason inline.
 */

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { useJobRooms } from "@/features/measurements/use-job-rooms";
import { useJobSites } from "@/features/measurements/use-job-sites";
import { useRoomScanAvailable } from "@/lib/native/room-scan";
import { userMessage } from "@/lib/trpc/error-map";
import { LoadFailed } from "@/components/shared/load-failed";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Row } from "@/components/ui/row";
import { Badge } from "@/components/ui/badge";
import { heldTraceSummary, type HeldTrace } from "@/lib/measure/held-trace";
import { seedFromHeldTrace } from "./held-trace-seed";
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
  /** True once the ?job= boot seeded the whole job — every job row starts "Seeded". */
  wholeJobSeeded: boolean;
  /** Traces held on THIS quote (composer state) — traced before any job exists. */
  heldTraces: readonly HeldTrace[];
  /** Receives the tracer's finished held trace. */
  onAddHeldTrace: (trace: HeldTrace) => void;
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
  heldTraces,
  onAddHeldTrace,
  onSeedLines,
}: MeasuredSurfacesPanelProps) {
  const enabled = useAppStore((s) => s.toggles.measurementEstimating);
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const services = useAppStore((s) => s.services);
  const roomsByJob = useAppStore((s) => s.roomsByJob);
  const sitesByJob = useAppStore((s) => s.sitesByJob);
  const addJob = useAppStore((s) => s.addJob);
  const openModal = useOpenModal();
  const utils = api.useUtils();
  const scanAvailable = useRoomScanAvailable();

  const [chosenJobId, setChosenJobId] = useState<string | null>(null);
  const [seededKeys, setSeededKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [seedingName, setSeedingName] = useState<string | null>(null);
  const [seedNotice, setSeedNotice] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [creatingRoomJob, setCreatingRoomJob] = useState(false);
  const [roomJobError, setRoomJobError] = useState<string | null>(null);

  const candidates = candidateJobsForLead(jobs, leadId);
  const countFor = (id: string) => jobCaptureCount(roomsByJob[id], sitesByJob[id]);
  const jobId = resolvePanelJob({ paramJobId, chosenJobId, candidates, countFor });

  // Hooks run unconditionally (null disables the queries) — the early return
  // below must come after them.
  const roomsQuery = useJobRooms(enabled ? jobId : null);
  const sitesQuery = useJobSites(enabled ? jobId : null);

  if (!enabled) return null;

  const rooms = jobId ? roomsByJob[jobId] : undefined;
  const sites = jobId ? sitesByJob[jobId] : undefined;
  // A failed fetch with nothing cached must never read as "nothing measured".
  const loadFailed =
    jobId !== null &&
    ((roomsQuery.isError && rooms === undefined) || (sitesQuery.isError && sites === undefined));
  // Job rows still hydrating (no error, a slice not seeded yet) — hold the JOB
  // rows back rather than popping them in a beat later; the section itself
  // (held rows + the tracer entry) renders regardless.
  const jobRowsHydrating = jobId !== null && !loadFailed && (rooms === undefined || sites === undefined);

  const rows = jobId && !jobRowsHydrating && !loadFailed ? panelRows(rooms ?? [], sites ?? []) : [];
  const options = panelJobOptions(candidates, countFor);
  const showSelector = !paramJobId && options.length >= 2;
  const jobSeeded = wholeJobSeeded && jobId === paramJobId;

  const nothingMeasured = heldTraces.length === 0 && rows.length === 0 && !loadFailed;

  function openTracer() {
    // The tracer needs no prerequisites — a picked customer's address just
    // saves the typing. Every trace made here is HELD on the quote.
    const lead = leadId ? leads.find((l) => l.id === leadId) : undefined;
    const persistedNames = jobId ? (sitesByJob[jobId] ?? []).map((s) => s.name) : [];
    openModal(MODAL.SITE_TRACER, {
      held: true,
      address: lead?.address?.trim() ?? "",
      existingNames: [...heldTraces.map((t) => t.name), ...persistedNames],
      onSaveHeld: onAddHeldTrace,
    });
  }

  /**
   * Opens the room card (create / scan mode) against the panel's job. A picked
   * customer with NO job yet gets an estimate job created silently first —
   * room scans ingest server-first (v1.measurements), so unlike a trace a room
   * cannot be held on the quote; the job row is the anchor the DB requires.
   */
  async function openRoomCard(mode?: "scan") {
    if (creatingRoomJob) return;
    setRoomJobError(null);
    let targetJobId = jobId;
    if (targetJobId === null) {
      const lead = leadId ? leads.find((l) => l.id === leadId) : undefined;
      if (!lead) return; // controls only render with a picked customer
      setCreatingRoomJob(true);
      // Same estimate-job shape new-job-modal creates for a walkthrough visit.
      const { job, persisted } = addJob({
        leadId: lead.id,
        svc: "estimate",
        origin: "manual",
        title: lead.job?.trim() || "Estimate",
        addr: lead.address?.trim() ?? "",
        phone: lead.phone && lead.phone !== "—" ? lead.phone : "",
        status: "unscheduled",
        archived: false,
        lines: [],
        addons: [],
        photos: [],
        notes: "",
        acts: [],
        visits: [],
      });
      try {
        // Room persistence needs the SERVER row (FK + RLS) — wait for it.
        await persisted;
      } catch (err: unknown) {
        setRoomJobError(
          userMessage(err, "Couldn't create a job to hold this room — check your connection and try again."),
        );
        setCreatingRoomJob(false);
        return;
      }
      setCreatingRoomJob(false);
      setChosenJobId(job.id);
      targetJobId = job.id;
    }
    openModal(MODAL.ROOM_CARD, mode ? { jobId: targetJobId, mode } : { jobId: targetJobId });
  }

  function seedHeld(trace: HeldTrace) {
    const key = `held::${trace.id}`;
    if (seedingName !== null || seededKeys.has(key)) return;
    setSeedError(null);
    setSeedNotice(null);
    const built = seedFromHeldTrace(trace, services);
    if (built.lines.length === 0) {
      setSeedNotice(
        `No priced service covers ${trace.name} yet — add one in the pricebook, then seed again.`,
      );
      return;
    }
    onSeedLines(built.lines);
    setSeededKeys((prev) => new Set([...prev, key]));
  }

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
      {jobId && <ProbesOnly candidates={candidates.map((j) => j.id)} selectedJobId={jobId} />}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: "0" }}>Measure</h3>
        <Button size="sm" onClick={openTracer}>
          Measure from satellite
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

      {!nothingMeasured && (
        <div style={{ marginTop: "var(--space-3)" }}>
          {heldTraces.map((trace) => {
            const seeded = seededKeys.has(`held::${trace.id}`);
            return (
              <Row
                key={trace.id}
                label={trace.name}
                value={heldTraceSummary(trace)}
                trailing={
                  <Button
                    size="sm"
                    disabled={seeded || seedingName !== null}
                    onClick={() => seedHeld(trace)}
                  >
                    {seeded ? "Seeded" : "Seed lines"}
                  </Button>
                }
              />
            );
          })}

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
            jobId !== null && (
              <SurfaceRows
                rows={rows}
                isSeeded={(name) => jobSeeded || seededKeys.has(seedKey(jobId, name))}
                seedingName={seedingName}
                onSeed={(name) => void seedSurface(name)}
                onOpenSite={(captureId) => openModal(MODAL.SITE_TRACER, { jobId, captureId })}
                onOpenRoom={(captureId) => openModal(MODAL.ROOM_CARD, { captureId, jobId })}
              />
            )
          )}
        </div>
      )}

      {/* Rooms are created/scanned from here now (the job modal's Measurements
          row is gone). Needs a picked customer — a room must anchor to one of
          their jobs; with none yet, openRoomCard creates the estimate job. */}
      {leadId !== null && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <Button size="sm" disabled={creatingRoomJob} onClick={() => void openRoomCard()}>
            + Add a room
          </Button>
          {scanAvailable && (
            <Button size="sm" disabled={creatingRoomJob} onClick={() => void openRoomCard("scan")}>
              Scan room
            </Button>
          )}
        </div>
      )}
      {roomJobError && (
        <p
          role="alert"
          style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-2) 0 0" }}
        >
          {roomJobError}
        </p>
      )}

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

/**
 * The job's capture rows with their per-surface seed action. Site rows open
 * the saved capture (tracer view mode); room rows open the room card, where
 * quantities are confirmed/overridden and a re-scan lives.
 */
function SurfaceRows({
  rows,
  isSeeded,
  seedingName,
  onSeed,
  onOpenSite,
  onOpenRoom,
}: {
  rows: readonly MeasuredRow[];
  isSeeded: (name: string) => boolean;
  seedingName: string | null;
  onSeed: (name: string) => void;
  onOpenSite: (captureId: string) => void;
  onOpenRoom: (captureId: string) => void;
}) {
  return (
    <>
      {rows.map((row) => {
        const seeded = isSeeded(row.name);
        const captureId = row.captureId;
        return (
          <Row
            key={`${row.kind}:${row.name}`}
            label={row.name}
            value={row.summary}
            trailing={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
                {row.needsConfirm && <Badge tone="amber">Confirm</Badge>}
                {captureId != null && (
                  <Button
                    size="sm"
                    aria-label={`Open ${row.name}`}
                    onClick={() =>
                      row.kind === "site" ? onOpenSite(captureId) : onOpenRoom(captureId)
                    }
                  >
                    Open
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={seeded || seedingName !== null}
                  onClick={() => onSeed(row.name)}
                >
                  {seeded ? "Seeded" : seedingName === row.name ? "Seeding…" : "Seed lines"}
                </Button>
              </span>
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
