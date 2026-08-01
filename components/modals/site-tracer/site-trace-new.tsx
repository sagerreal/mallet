/**
 * components/modals/site-tracer/site-trace-new.tsx
 * Trace mode: tap the satellite map to outline a surface, watch the running
 * square-feet / perimeter figures in the anchored bar, close the outline (tap
 * the first vertex or Done), then name it, pick Flat | Pitched, and save.
 *
 * The saved working area is the SERVER's number (footprint + pitch go up, the
 * corrected area comes back) — the pitched figure shown before save is an
 * explicit preview using the same formula.
 */

"use client";

import { useMemo, useRef, useState } from "react";
import { useAppStore, useCloseModal } from "@/lib/store/app-store";
import { useGoogleMaps } from "@/features/measurements/aerial/use-google-maps";
import { useTracerMap } from "@/features/measurements/aerial/use-tracer-map";
import { measureTrace } from "@/features/measurements/aerial/map-measure";
import {
  EMPTY_TRACE,
  addVertex,
  undoLast,
  clearTrace,
  canClose,
  closeTrace,
  MIN_TRACE_VERTICES,
  type TraceState,
} from "@/lib/measure/trace-state";
import {
  formatSqft,
  formatLnft,
  nextSurfaceName,
  pitchCorrectedAreaPreview,
  surfaceSummary,
} from "@/lib/measure/aerial-geometry";
import { userMessage } from "@/lib/trpc/error-map";
import { Field } from "@/components/ui/input";
import { SrcPill } from "@/components/shared/stage-pill";
import { SurfaceToggle, PitchRow } from "./site-surface-controls";
import { TracerMapCanvas } from "./tracer-map-canvas";

const SAVE_ERROR_COPY = "Couldn't save this surface — check your connection and try again.";
const NO_AREA_COPY = "This outline has no area — trace at least three points around the surface.";
const MAP_NOT_READY_COPY = "The map isn't ready yet — wait for the imagery, then save again.";
/** Starting pitch when a surface flips to Pitched — the most common roof, one tap to change. */
const DEFAULT_PITCH_RISE = 6;

interface SiteTraceNewProps {
  jobId: string;
  jobTitle: string | undefined;
  address: string;
  existingNames: readonly string[];
}

export function SiteTraceNew({ jobId, jobTitle, address, existingNames }: SiteTraceNewProps) {
  const close = useCloseModal();
  const addTracedSite = useAppStore((s) => s.addTracedSite);

  const [trace, setTrace] = useState<TraceState>(EMPTY_TRACE);
  const [name, setName] = useState(() => nextSurfaceName(existingNames));
  const [surface, setSurface] = useState<"flat" | "pitched">("flat");
  const [pitchRise, setPitchRise] = useState(DEFAULT_PITCH_RISE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mapsStatus = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const tracerMap = useTracerMap({
    status: mapsStatus,
    containerRef: mapRef,
    savedView: null,
    address,
    vertices: trace.vertices,
    closed: trace.closed,
    interactive: true,
    onMapClick: (vertex) => setTrace((s) => addVertex(s, vertex)),
    onFirstVertexClick: () => setTrace((s) => closeTrace(s)),
  });

  const figures = useMemo(
    () => measureTrace(trace.vertices, trace.closed),
    // mapsStatus: figures become computable the moment the geometry library lands.
    [trace.vertices, trace.closed, mapsStatus],
  );

  async function save() {
    if (saving) return;
    setSaveError(null);
    if (figures === null || figures.footprintSqft <= 0) {
      setSaveError(NO_AREA_COPY);
      return;
    }
    const view = tracerMap.getView();
    if (view === null) {
      setSaveError(MAP_NOT_READY_COPY);
      return;
    }
    setSaving(true);
    try {
      await addTracedSite({
        jobId,
        name: name.trim() || nextSurfaceName(existingNames),
        surface,
        pitchRise: surface === "pitched" ? pitchRise : undefined,
        polygon: { vertices: [...trace.vertices], view },
        footprintSqft: figures.footprintSqft,
        perimeterLnft: figures.perimeterLnft,
      });
      close();
    } catch (err: unknown) {
      setSaveError(userMessage(err, SAVE_ERROR_COPY));
    } finally {
      setSaving(false);
    }
  }

  const showMap = mapsStatus === "loading" || mapsStatus === "ready";

  return (
    <div>
      <div className="sheet-head">
        <h2>Trace from satellite</h2>
        <div className="sheet-meta">
          <SrcPill src="Aerial" />
          {jobTitle && <span>{jobTitle}</span>}
          {address && <span>{address}</span>}
        </div>
      </div>

      <TracerMapCanvas
        status={mapsStatus}
        geocode={tracerMap.geocode}
        address={address}
        mapRef={mapRef}
      />

      {showMap && (
        <div className="tracer-bar">
          {figures !== null && trace.vertices.length >= 2 ? (
            <>
              {trace.vertices.length >= MIN_TRACE_VERTICES && (
                <span className="fig">{formatSqft(figures.footprintSqft)}</span>
              )}
              <span className="fig">{formatLnft(figures.perimeterLnft)}</span>
            </>
          ) : (
            <span className="muted">Tap the map to outline the surface</span>
          )}
          <span className="gap" />
          <button
            type="button"
            className="btn sm"
            disabled={trace.vertices.length === 0}
            onClick={() => setTrace((s) => undoLast(s))}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={trace.vertices.length === 0}
            onClick={() => {
              setTrace(clearTrace());
              setSaveError(null);
            }}
          >
            Clear
          </button>
          {!trace.closed && (
            <button
              type="button"
              className="btn sm"
              disabled={!canClose(trace)}
              onClick={() => setTrace((s) => closeTrace(s))}
            >
              Done
            </button>
          )}
        </div>
      )}

      {trace.closed && figures !== null && (
        <>
          <Field label="Surface name">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div style={{ marginTop: "var(--space-3)" }}>
            <SurfaceToggle surface={surface} onChange={setSurface} />
          </div>

          {surface === "pitched" && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <PitchRow pitchRise={pitchRise} onChange={setPitchRise} />
            </div>
          )}

          <p style={{ fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>
            {surfaceSummary({
              surface,
              pitchRise: surface === "pitched" ? pitchRise : null,
              areaSqft:
                surface === "pitched"
                  ? pitchCorrectedAreaPreview(figures.footprintSqft, pitchRise)
                  : figures.footprintSqft,
              footprintSqft: figures.footprintSqft,
            })}
            {" · Perimeter "}
            {formatLnft(figures.perimeterLnft)}
          </p>

          {saveError && (
            <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>
              {saveError}
            </p>
          )}

          <div className="sheet-foot">
            <button type="button" className="sheet-pri" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save surface"}
            </button>
          </div>
        </>
      )}

      {!trace.closed && saveError && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>
          {saveError}
        </p>
      )}
    </div>
  );
}
