"use client";

/**
 * features/measurements/aerial/use-tracer-map.ts
 * Owns the Google Map instance for the aerial tracer: creates the satellite
 * map, seeds the view (saved view → seed coordinates → geocoded address →
 * wide default), mirrors the trace (markers + open polyline / closed polygon)
 * onto it, and reports geocode state by name so the UI never fails silently.
 *
 * Seed coordinates (from Places autocomplete's Place Details) are the PRIMARY
 * path when present — the map pans straight to them with no Geocoding API
 * call. Geocoding is the fallback for an address that never touched
 * autocomplete (job addresses, hand-typed addresses committed on blur); it
 * requires the Geocoding API to be enabled on the Maps key, which Places
 * autocomplete alone does not prove.
 *
 * The hook renders NOTHING over the map — vertex markers are the only
 * permitted map overlay (house rule: no floating UI); all controls live in the
 * caller's anchored bars.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MapsStatus } from "./use-google-maps";
import { MIN_TRACE_VERTICES, type TraceVertex } from "@/lib/measure/trace-state";
import type { SiteMapView } from "@/lib/store/types";

export type GeocodeState = "idle" | "pending" | "no-address" | "failed";

export interface SeedLocation {
  lat: number;
  lng: number;
}

/** How the view should be seeded — pure precedence rule, exported for tests. */
export type SeedPlan =
  | { kind: "saved" }
  | { kind: "location"; location: SeedLocation }
  | { kind: "no-address" }
  | { kind: "geocode"; address: string };

export function seedPlan(
  savedView: SiteMapView | null,
  seedLocation: SeedLocation | null,
  address: string,
): SeedPlan {
  if (savedView !== null) return { kind: "saved" };
  if (seedLocation !== null) return { kind: "location", location: seedLocation };
  const trimmed = address.trim();
  if (trimmed === "") return { kind: "no-address" };
  return { kind: "geocode", address };
}

// Continental-US wide shot — only ever seen when a job has no usable address.
const DEFAULT_CENTER = { lat: 39.8283, lng: -98.5795 };
const DEFAULT_WIDE_ZOOM = 4;
/** Rooftop-level zoom once an address geocodes. */
const TRACE_ZOOM = 20;

const VERTEX_SCALE = 5;
const FIRST_VERTEX_SCALE = 8;
const STROKE_WEIGHT = 2;
const FILL_OPACITY = 0.25;

// Overlays draw on satellite PHOTOGRAPHY, not themed UI — theme tokens (near-black
// in light mode) would vanish on dark rooftops, so the trace is fixed white, the
// standard for imagery overlays. #FFFFFF already exists in the palette (--pri-fg).
const OVERLAY_COLOR = "#FFFFFF";

export interface UseTracerMapArgs {
  status: MapsStatus;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Saved view from an existing capture — wins over geocoding. */
  savedView: SiteMapView | null;
  /**
   * Known coordinates for the address (Places autocomplete → Place Details).
   * When present the map pans straight here — no Geocoding API call.
   */
  seedLocation: SeedLocation | null;
  /** Address to geocode when there is no saved view and no seed location. Empty = none. */
  address: string;
  vertices: readonly TraceVertex[];
  closed: boolean;
  /** False for the read-only view of a saved capture. */
  interactive: boolean;
  onMapClick?: (vertex: TraceVertex) => void;
  onFirstVertexClick?: () => void;
}

export interface TracerMapHandle {
  geocode: GeocodeState;
  /** Current map view, for persisting alongside the polygon. Null until the map exists. */
  getView: () => SiteMapView | null;
}

export function useTracerMap(args: UseTracerMapArgs): TracerMapHandle {
  const { status, containerRef, savedView, seedLocation, address, vertices, closed, interactive } =
    args;

  const mapRef = useRef<google.maps.Map | null>(null);
  const clickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const markerListenersRef = useRef<google.maps.MapsEventListener[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const polygonRef = useRef<google.maps.Polygon | null>(null);

  // Latest-callback refs so the map click listener never goes stale and the
  // map-creation effect doesn't depend on unstable function props.
  const onMapClickRef = useRef(args.onMapClick);
  const onFirstVertexClickRef = useRef(args.onFirstVertexClick);
  onMapClickRef.current = args.onMapClick;
  onFirstVertexClickRef.current = args.onFirstVertexClick;

  const [mapReady, setMapReady] = useState(false);
  const [geocode, setGeocode] = useState<GeocodeState>("idle");

  // ---- create the map once the API and container exist ----------------------
  useEffect(() => {
    if (status !== "ready" || mapRef.current !== null) return;
    const container = containerRef.current;
    if (container === null) return;

    const map = new google.maps.Map(container, {
      center: savedView
        ? { lat: savedView.centerLat, lng: savedView.centerLng }
        : DEFAULT_CENTER,
      zoom: savedView ? savedView.zoom : DEFAULT_WIDE_ZOOM,
      mapTypeId: "satellite",
      tilt: 0,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      gestureHandling: "greedy",
      draggableCursor: interactive ? "crosshair" : undefined,
    });
    mapRef.current = map;

    if (interactive) {
      clickListenerRef.current = map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (e.latLng === null) return;
        onMapClickRef.current?.({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
    }

    setMapReady(true);
    // The container div lives and dies with the modal — dropping our references
    // on unmount is enough for the map to be collected.
    return () => {
      clickListenerRef.current?.remove();
      clickListenerRef.current = null;
      mapRef.current = null;
      setMapReady(false);
    };
    // savedView/interactive are deliberately not dependencies — both are fixed
    // for the life of one tracer opening, and the map must be created once.
  }, [status, containerRef]);

  // ---- seed the view: saved view → seed coordinates → geocode the address ----
  useEffect(() => {
    if (!mapReady) return;
    const plan = seedPlan(savedView, seedLocation, address);
    if (plan.kind === "saved") return;
    if (plan.kind === "location") {
      // Coordinates came with the address (Places autocomplete) — jump
      // straight there. No Geocoding API involved.
      mapRef.current?.setCenter(plan.location);
      mapRef.current?.setZoom(TRACE_ZOOM);
      setGeocode("idle");
      return;
    }
    if (plan.kind === "no-address") {
      setGeocode("no-address");
      return;
    }
    let cancelled = false;
    setGeocode("pending");
    new google.maps.Geocoder()
      .geocode({ address })
      .then((res) => {
        if (cancelled) return;
        const location = res.results[0]?.geometry.location;
        if (location === undefined) {
          setGeocode("failed");
          return;
        }
        mapRef.current?.setCenter({ lat: location.lat(), lng: location.lng() });
        mapRef.current?.setZoom(TRACE_ZOOM);
        setGeocode("idle");
      })
      .catch(() => {
        if (!cancelled) setGeocode("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [mapReady, savedView, seedLocation, address]);

  // ---- mirror the trace onto the map ----------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || map === null) return;

    const path = vertices.map((v) => ({ lat: v.lat, lng: v.lng }));
    const closable = interactive && !closed && vertices.length >= MIN_TRACE_VERTICES;

    const markers = path.map((position, i) => {
      const isFirst = i === 0;
      return new google.maps.Marker({
        position,
        map,
        clickable: isFirst && closable,
        cursor: isFirst && closable ? "pointer" : undefined,
        title: isFirst && closable ? "Close the outline" : undefined,
        zIndex: isFirst ? 2 : 1,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isFirst && closable ? FIRST_VERTEX_SCALE : VERTEX_SCALE,
          fillColor: OVERLAY_COLOR,
          fillOpacity: 1,
          strokeColor: OVERLAY_COLOR,
          strokeWeight: STROKE_WEIGHT,
        },
      });
    });
    const listeners: google.maps.MapsEventListener[] = [];
    const firstMarker = markers[0];
    if (firstMarker !== undefined && closable) {
      listeners.push(firstMarker.addListener("click", () => onFirstVertexClickRef.current?.()));
    }
    markersRef.current = markers;
    markerListenersRef.current = listeners;

    if (closed && path.length >= MIN_TRACE_VERTICES) {
      polygonRef.current = new google.maps.Polygon({
        paths: path,
        map,
        strokeColor: OVERLAY_COLOR,
        strokeOpacity: 1,
        strokeWeight: STROKE_WEIGHT,
        fillColor: OVERLAY_COLOR,
        fillOpacity: FILL_OPACITY,
        clickable: false,
      });
    } else if (path.length >= 2) {
      polylineRef.current = new google.maps.Polyline({
        path,
        map,
        strokeColor: OVERLAY_COLOR,
        strokeOpacity: 1,
        strokeWeight: STROKE_WEIGHT,
        clickable: false,
      });
    }

    return () => {
      markerListenersRef.current.forEach((l) => l.remove());
      markerListenersRef.current = [];
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      polylineRef.current?.setMap(null);
      polylineRef.current = null;
      polygonRef.current?.setMap(null);
      polygonRef.current = null;
    };
  }, [mapReady, vertices, closed, interactive]);

  return {
    geocode,
    getView: () => {
      const map = mapRef.current;
      const center = map?.getCenter();
      const zoom = map?.getZoom();
      if (map === null || center === undefined || zoom === undefined) return null;
      return { centerLat: center.lat(), centerLng: center.lng(), zoom };
    },
  };
}
