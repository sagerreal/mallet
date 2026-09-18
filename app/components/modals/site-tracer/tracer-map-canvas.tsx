/**
 * components/modals/site-tracer/tracer-map-canvas.tsx
 * The map region of the tracer sheet: named states for every way the imagery
 * can fail to appear (missing key, script failure, loading, geocode problems)
 * rendered IN-FLOW above the map — never a silent blank, never floating over
 * the imagery.
 */

"use client";

import type { RefObject } from "react";
import type { MapsStatus } from "@/features/measurements/aerial/use-google-maps";
import type { GeocodeState } from "@/features/measurements/aerial/use-tracer-map";

interface TracerMapCanvasProps {
  status: MapsStatus;
  geocode: GeocodeState;
  /** The address being geocoded — named in the failure copy. */
  address: string;
  /** Overrides the no-address note — the held-trace flow has no job to point at. */
  noAddressCopy?: string;
  mapRef: RefObject<HTMLDivElement | null>;
}

function geocodeNote(
  geocode: GeocodeState,
  address: string,
  noAddressCopy: string | undefined,
): string | null {
  switch (geocode) {
    case "pending":
      return "Finding the address…";
    case "no-address":
      return (
        noAddressCopy ??
        "This job has no address. Set the job's address to start here, or pan and zoom to the site."
      );
    case "failed":
      return `Couldn't find "${address}" on the map — pan and zoom to the site.`;
    case "idle":
      return null;
  }
}

export function TracerMapCanvas({ status, geocode, address, noAddressCopy, mapRef }: TracerMapCanvasProps) {
  if (status === "missing-key") {
    return (
      <p className="tracer-note">
        Satellite imagery isn&apos;t set up — the Google Maps key
        (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) is missing from this environment.
      </p>
    );
  }

  if (status === "failed") {
    return (
      <p className="tracer-note">
        The map couldn&apos;t load — check your connection, then close and reopen this trace.
      </p>
    );
  }

  const note =
    status === "loading" ? "Loading satellite imagery…" : geocodeNote(geocode, address, noAddressCopy);

  return (
    <>
      {note && <p className="tracer-note">{note}</p>}
      <div className="tracer-map" ref={mapRef} aria-label="Satellite map" role="application" />
    </>
  );
}
