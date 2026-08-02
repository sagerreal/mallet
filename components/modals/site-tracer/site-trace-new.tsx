/**
 * components/modals/site-tracer/site-trace-new.tsx
 * Trace mode: tap the satellite map to outline a surface, watch the running
 * square-feet / perimeter figures in the anchored bar, close the outline (tap
 * the first vertex or Done), then name it, pick Flat | Pitched, and save.
 *
 * TWO save targets (satellite measurement is an estimating feature — the
 * composer opens this with zero prerequisites):
 *   - "job":  the original flow — persists via addTracedSite (server derives
 *     the working area), rows land in sitesByJob.
 *   - "held": the quote-page flow — no job exists yet, so the header carries
 *     an address input (Places autocomplete) to find the property, and the
 *     finished trace is handed back to the caller as a HeldTrace (pure client
 *     math, same formula the server uses — see lib/measure/held-trace.ts).
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
import { createHeldTrace, type HeldTrace } from "@/lib/measure/held-trace";
import { userMessage } from "@/lib/trpc/error-map";
import { Field } from "@/components/ui/input";
import { AddressInput } from "@/components/ui/address-input";
import { SrcPill } from "@/components/shared/stage-pill";
import { SurfaceToggle, PitchRow } from "./site-surface-controls";
import { TracerMapCanvas } from "./tracer-map-canvas";

const SAVE_ERROR_COPY = "Couldn't save this surface — check your connection and try again.";
const NO_AREA_COPY = "This outline has no area — trace at least three points around the surface.";
const MAP_NOT_READY_COPY = "The map isn't ready yet — wait for the imagery, then save again.";
/** Starting pitch when a surface flips to Pitched — the most common roof, one tap to change. */
const DEFAULT_PITCH_RISE = 6;

/** Where a finished trace goes — a job's site captures, or held on the quote. */
export type SiteTraceTarget =
  | { kind: "job"; jobId: string; jobTitle: string | undefined; address: string }
  | { kind: "held"; initialAddress: string; onSave: (trace: HeldTrace) => void };

interface SiteTraceNewProps {
  target: SiteTraceTarget;
  existingNames: readonly string[];
}

export function SiteTraceNew({ target, existingNames }: SiteTraceNewProps) {
  const close = useCloseModal();
  const addTracedSite = useAppStore((s) => s.addTracedSite);

  const [trace, setTrace] = useState<TraceState>(EMPTY_TRACE);
  const [name, setName] = useState(() => nextSurfaceName(existingNames));
  const [surface, setSurface] = useState<"flat" | "pitched">("flat");
  const [pitchRise, setPitchRise] = useState(DEFAULT_PITCH_RISE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Held mode: the typed address (live) vs the one the map geocodes (committed
  // on suggestion select / blur — never per keystroke).
  const [address, setAddress] = useState(target.kind === "held" ? target.initialAddress : "");
  const [committedAddress, setCommittedAddress] = useState(
    target.kind === "held" ? target.initialAddress : "",
  );
  const mapAddress = target.kind === "job" ? target.address : committedAddress;

  const mapsStatus = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const tracerMap = useTracerMap({
    status: mapsStatus,
    containerRef: mapRef,
    savedView: null,
    address: mapAddress,
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
    const surfaceName = name.trim() || nextSurfaceName(existingNames);

    if (target.kind === "held") {
      // Pure client math — no server call. The composer holds the trace until
      // the quote's flow has a job to persist it against.
      target.onSave(
        createHeldTrace({
          id: crypto.randomUUID(),
          name: surfaceName,
          surface,
          pitchRise: surface === "pitched" ? pitchRise : undefined,
          polygon: { vertices: [...trace.vertices], view },
          footprintSqft: figures.footprintSqft,
          perimeterLnft: figures.perimeterLnft,
        }),
      );
      close();
      return;
    }

    setSaving(true);
    try {
      await addTracedSite({
        jobId: target.jobId,
        name: surfaceName,
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
        <h2>Measure from satellite</h2>
        <div className="sheet-meta">
          <SrcPill src="Aerial" />
          {target.kind === "job" && target.jobTitle && <span>{target.jobTitle}</span>}
          {target.kind === "job" && target.address && <span>{target.address}</span>}
        </div>
      </div>

      {target.kind === "held" && (
        <Field label="Property address">
          <AddressInput
            value={address}
            onChange={setAddress}
            onSelect={(v) => setCommittedAddress(v)}
            onBlur={() => setCommittedAddress(address)}
            placeholder="Type the property address"
            aria-label="Property address"
          />
        </Field>
      )}

      <TracerMapCanvas
        status={mapsStatus}
        geocode={tracerMap.geocode}
        address={mapAddress}
        noAddressCopy={
          target.kind === "held"
            ? "Type the property address to jump there, or pan and zoom to the site."
            : undefined
        }
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
