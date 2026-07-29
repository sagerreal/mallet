/**
 * lib/native/room-scan.ts
 * The ONE place that knows the `MalletRoomScan` native plugin's contract. Everything
 * upstream (the measurements store slice, the scan UI) goes through the exports here
 * instead of touching `nativePlugin` directly.
 *
 * Availability is a TWO-PART question, not one:
 *   1. Is the plugin object present at all? (`roomScanPlugin() !== null`) — false on the
 *      web, and false in the brief window before Capacitor injects the bridge.
 *   2. Even when present, is scanning actually USABLE right now? `roomScanAvailable()`
 *      awaits the plugin's own `available()` call, which returns
 *      `{ available: boolean, reason?: string }` — but that call only reflects the
 *      NATIVE device gate (`RoomCaptureSession.isSupported`, i.e. LiDAR/device support),
 *      e.g. false on an iOS 17 phone with no LiDAR sensor. It does NOT check Camera
 *      permission — a LiDAR phone whose user denied Camera can still report
 *      `available: true` here; that denial only surfaces later, as a `captureRoom`
 *      rejection when the native session actually tries to start.
 *
 * Task 4 (the UI) MUST gate the scan entry point on `roomScanAvailable()`, NOT on mere
 * plugin presence — showing a scan button that immediately fails `captureRoom` is worse
 * than not showing it, per the house "no dead buttons" rule.
 *
 * `captureRoom` throws if the plugin is absent — callers gate on `roomScanPlugin()` (or
 * `roomScanAvailable()`) first; this is NOT best-effort work like `lib/native-bridge.ts`'s
 * `attempt()` — a scan the user explicitly started must not silently do nothing.
 */

import { useEffect, useState } from "react";
import { nativePlugin } from "@/lib/native-bridge";

const PLUGIN_NAME = "MalletRoomScan";

/** Raw wire result from the native plugin — geometry/rawPayload are JSON-encoded strings. */
export type RoomScanResult =
  | {
      status: "done";
      rawPayload: string;
      geometry: string;
      capturedAt: string;
    }
  | {
      status: "cancelled";
    };

export interface RoomScanPlugin {
  captureRoom(options: { roomName: string }): Promise<RoomScanResult>;
  available(): Promise<{ available: boolean; reason?: string }>;
}

/** The named native plugin, or null on the web / before the bridge is injected. */
export function roomScanPlugin(): RoomScanPlugin | null {
  return nativePlugin<RoomScanPlugin>(PLUGIN_NAME);
}

/**
 * Whether room scanning can actually be used right now. False when the plugin is absent
 * (web, or bridge not yet injected), false when the plugin itself reports the device
 * doesn't support it (no LiDAR — `RoomCaptureSession.isSupported` is the native gate this
 * reflects), and false if the availability check itself throws or rejects — an
 * availability probe that fails is not a "yes". Does NOT cover Camera permission: a
 * LiDAR device with permission denied can still report `available: true` here — that
 * denial surfaces later as a `captureRoom` rejection instead.
 */
export async function roomScanAvailable(): Promise<boolean> {
  const plugin = roomScanPlugin();
  if (!plugin) return false;
  try {
    const result = await plugin.available();
    return result.available;
  } catch {
    return false;
  }
}

// Module-level cache: the plugin's availability (LiDAR present, permission granted)
// does not change mid-session, so the probe runs once for the app's lifetime rather
// than once per mount — every JobMeasureBlock/room-card-modal instance shares the
// same in-flight promise instead of firing its own native round trip.
let cachedRoomScanAvailable: boolean | null = null;
let roomScanAvailableProbe: Promise<boolean> | null = null;

/** Test-only: clears the module-level availability cache between test cases. */
export function resetRoomScanAvailableCache(): void {
  cachedRoomScanAvailable = null;
  roomScanAvailableProbe = null;
}

/**
 * React hook wrapping `roomScanAvailable()`. Starts `false` (hide the scan entry
 * point) until the one-time probe resolves — a control that flashes in and then
 * has to disappear again reads worse than one that simply appears once ready.
 * UI callers MUST gate the scan entry point on this, not on `roomScanPlugin()`
 * presence alone (see module doc above).
 */
export function useRoomScanAvailable(): boolean {
  const [available, setAvailable] = useState(cachedRoomScanAvailable ?? false);

  useEffect(() => {
    if (cachedRoomScanAvailable !== null) {
      setAvailable(cachedRoomScanAvailable);
      return;
    }
    if (!roomScanAvailableProbe) {
      roomScanAvailableProbe = roomScanAvailable();
    }
    let cancelled = false;
    roomScanAvailableProbe.then((result) => {
      cachedRoomScanAvailable = result;
      if (!cancelled) setAvailable(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}

/** Parsed, typed scan outcome — the JSON strings the plugin returns are parsed here. */
export type ParsedRoomScanResult =
  | {
      status: "done";
      rawPayload: unknown;
      geometry: unknown;
      capturedAt: string;
    }
  | {
      status: "cancelled";
    };

/** Thrown when the plugin's `rawPayload` or `geometry` string is not valid JSON. */
export class RoomScanPayloadError extends Error {
  constructor(field: "rawPayload" | "geometry", cause: unknown) {
    super(`MalletRoomScan returned invalid JSON for "${field}"`);
    this.name = "RoomScanPayloadError";
    this.cause = cause;
  }
}

function parseJsonField(field: "rawPayload" | "geometry", raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new RoomScanPayloadError(field, e);
  }
}

/**
 * Thrown when the native `captureRoom` call itself rejects (as opposed to resolving with
 * `{ status: "cancelled" }`, which is a normal outcome, not an error). The native side sends
 * functional, user-facing copy in the rejection message — e.g. "The scan didn't capture a
 * floor — walk the room's perimeter and scan again.", "A room scan is already open.", or a
 * LiDAR-loss message — and this class carries that message through VERBATIM so UI callers can
 * show it as-is instead of collapsing every capture failure into a generic "check your
 * connection" copy that would misattribute e.g. a no-floor scan to a network problem.
 */
export class RoomScanCaptureError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "MalletRoomScan capture failed");
    this.name = "RoomScanCaptureError";
    this.cause = cause;
  }
}

/**
 * Run a native room scan. Throws if the plugin is absent — callers must gate on
 * `roomScanPlugin()` (presence) or, better, `roomScanAvailable()` (actually usable)
 * before calling this. Parses both JSON-string fields the plugin returns; invalid JSON
 * from the plugin surfaces as a named `RoomScanPayloadError` rather than being swallowed.
 * A rejection from the native `captureRoom` call itself (as opposed to a JSON-parse failure
 * on its result) surfaces as a named `RoomScanCaptureError` carrying the native message.
 */
export async function captureRoom(roomName: string): Promise<ParsedRoomScanResult> {
  const plugin = roomScanPlugin();
  if (!plugin) {
    throw new Error("MalletRoomScan plugin is not available — gate callers on roomScanAvailable()");
  }

  let result: RoomScanResult;
  try {
    result = await plugin.captureRoom({ roomName });
  } catch (e: unknown) {
    throw new RoomScanCaptureError(e);
  }

  if (result.status === "cancelled") {
    return { status: "cancelled" };
  }

  return {
    status: "done",
    rawPayload: parseJsonField("rawPayload", result.rawPayload),
    geometry: parseJsonField("geometry", result.geometry),
    capturedAt: result.capturedAt,
  };
}
