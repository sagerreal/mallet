"use client";

/**
 * features/measurements/aerial/use-google-maps.ts
 * One-shot loader for the Google Maps JS API (satellite tracer). Follows the
 * AddressInput convention: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY drives everything,
 * and a missing key is a NAMED state ("missing-key"), never a silent blank.
 *
 * The script is injected once per page (module-level promise) with the
 * geometry library — spherical.computeArea/computeLength power the live
 * measurements. `loading=async` + a callback is Google's supported async
 * pattern; script.onerror covers the network-failure path.
 */

import { useEffect, useState } from "react";

export type MapsStatus = "missing-key" | "loading" | "ready" | "failed";

const MAPS_URL = "https://maps.googleapis.com/maps/api/js";
const READY_CALLBACK = "__malletMapsReady";

let loadPromise: Promise<void> | null = null;

function mapsAlreadyLoaded(): boolean {
  return typeof google !== "undefined" && typeof google.maps !== "undefined";
}

function loadMapsScript(apiKey: string): Promise<void> {
  if (mapsAlreadyLoaded()) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown>;
    w[READY_CALLBACK] = () => resolve();

    const params = new URLSearchParams({
      key: apiKey,
      v: "weekly",
      libraries: "geometry",
      loading: "async",
      callback: READY_CALLBACK,
    });
    const script = document.createElement("script");
    script.src = `${MAPS_URL}?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      // Allow a later retry (fresh mount) to inject a new script tag.
      loadPromise = null;
      reject(new Error("Google Maps script failed to load"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

/** Loads the Maps JS API and reports a named status — callers render each state. */
export function useGoogleMaps(): MapsStatus {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [status, setStatus] = useState<MapsStatus>(() => {
    if (!apiKey) return "missing-key";
    return mapsAlreadyLoaded() ? "ready" : "loading";
  });

  useEffect(() => {
    if (!apiKey || status !== "loading") return;
    let cancelled = false;
    loadMapsScript(apiKey)
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey, status]);

  return status;
}
