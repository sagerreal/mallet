/**
 * components/modals/site-tracer/site-capture-view.tsx
 * A saved surface: the map re-opened EXACTLY where it was traced (the
 * persisted view), the outline drawn read-only, and the editable facts —
 * name, Flat | Pitched, pitch — as sheet rows. The server recomputes the
 * working area on every surface/pitch change; the store reconciles from the
 * returned DTO.
 *
 * The polygon itself is fixed once saved (the backend has no polygon update);
 * a mis-traced surface is removed and traced again.
 */

"use client";

import { useRef, useState } from "react";
import { useAppStore, useCloseModal } from "@/lib/store/app-store";
import { useGoogleMaps } from "@/features/measurements/aerial/use-google-maps";
import { useTracerMap } from "@/features/measurements/aerial/use-tracer-map";
import { formatLnft, pitchLabel, surfaceSummary } from "@/lib/measure/aerial-geometry";
import { formatDate } from "@/lib/format";
import { SrcPill } from "@/components/shared/stage-pill";
import { SheetRow } from "../sheet-row";
import { Field } from "@/components/ui/input";
import { SurfaceToggle, PitchRow } from "./site-surface-controls";
import { TracerMapCanvas } from "./tracer-map-canvas";
import type { SiteCard } from "@/lib/store/types";

/** Starting pitch when a saved surface flips to Pitched — visible immediately, one tap to change. */
const DEFAULT_PITCH_RISE = 6;

function NameRow({ site, onRename }: { site: SiteCard; onRename: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(site.name);

  function openEditor(next: boolean) {
    setOpen(next);
    if (next) setDraft(site.name);
  }

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== site.name) onRename(trimmed);
    setOpen(false);
  }

  return (
    <SheetRow label="Surface name" value={site.name} expandable open={open} onOpenChange={openEditor}>
      <Field label="Surface name">
        <input
          type="text"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
    </SheetRow>
  );
}

function RemoveSurfaceRow({ onRemove }: { onRemove: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <div className="sheet-foot">
      <button
        type="button"
        className="btn ghost"
        style={{ color: "var(--red)", borderColor: armed ? "var(--red)" : undefined, width: "100%" }}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          onRemove();
        }}
      >
        {armed ? "Really remove this surface? Tap again" : "Remove surface"}
      </button>
    </div>
  );
}

export function SiteCaptureView({ site, jobTitle }: { site: SiteCard; jobTitle: string | undefined }) {
  const close = useCloseModal();
  const updateSite = useAppStore((s) => s.updateSite);
  const archiveSite = useAppStore((s) => s.archiveSite);

  const mapsStatus = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const tracerMap = useTracerMap({
    status: mapsStatus,
    containerRef: mapRef,
    savedView: site.polygon?.view ?? null,
    address: "",
    vertices: site.polygon?.vertices ?? [],
    closed: true,
    interactive: false,
  });

  function setSurface(surface: "flat" | "pitched") {
    if (surface === site.surface) return;
    updateSite(site.jobId, site.id, {
      surface,
      pitchRise: surface === "pitched" ? (site.pitchRise ?? DEFAULT_PITCH_RISE) : undefined,
    });
  }

  function setPitch(pitchRise: number) {
    if (pitchRise === site.pitchRise) return;
    updateSite(site.jobId, site.id, { surface: "pitched", pitchRise });
  }

  const sourceLabel = site.source === "manual" ? "Manual" : `Traced · ${formatDate(site.createdAt)}`;

  return (
    <div>
      <div className="sheet-head">
        <h2>{site.name}</h2>
        <div className="sheet-meta">
          <SrcPill src={sourceLabel} />
          {jobTitle && <span>{jobTitle}</span>}
        </div>
      </div>

      {site.polygon !== null && (
        <TracerMapCanvas status={mapsStatus} geocode={tracerMap.geocode} address="" mapRef={mapRef} />
      )}

      <p style={{ fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>
        {surfaceSummary(site)}
        {site.perimeterLnft !== null && ` · Perimeter ${formatLnft(site.perimeterLnft)}`}
      </p>

      <div className="sheet-rows">
        <NameRow site={site} onRename={(name) => updateSite(site.jobId, site.id, { name })} />

        <SheetRow
          label="Surface"
          value={site.surface === "flat" ? "Flat" : `Pitched · ${pitchLabel(site.pitchRise ?? DEFAULT_PITCH_RISE)}`}
          expandable
        >
          <SurfaceToggle surface={site.surface} onChange={setSurface} />
          {site.surface === "pitched" && (
            <div style={{ marginTop: "var(--space-3)" }}>
              <PitchRow pitchRise={site.pitchRise ?? DEFAULT_PITCH_RISE} onChange={setPitch} />
            </div>
          )}
        </SheetRow>
      </div>

      <RemoveSurfaceRow
        onRemove={() => {
          archiveSite(site.jobId, site.id);
          close();
        }}
      />
    </div>
  );
}
