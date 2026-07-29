/**
 * lib/native/room-scan.ts
 * The ONE place that knows the `MalletRoomScan` native plugin's contract. Everything
 * upstream (the measurements store slice, the scan UI) goes through the exports here
 * instead of touching `nativePlugin` directly.
 *
 * Availability is a TWO-PART question, not one:
 *   1. Is the plugin object present at all? (`roomScanPlugin() !== null`) — false on the
 *      web, and false in the brief window before Capacitor injects the bridge.
 *   2. Even when present, is scanning actually USABLE right now? A plugin object can
 *      exist on an iOS 17 phone with no LiDAR sensor while being permanently unusable,
 *      or on a LiDAR phone whose user denied Camera permission. `roomScanAvailable()`
 *      is the honest answer to "can I scan" — it awaits the plugin's own `available()`
 *      call, which returns `{ available: boolean, reason?: string }`.
 *
 * Task 4 (the UI) MUST gate the scan entry point on `roomScanAvailable()`, NOT on mere
 * plugin presence — showing a scan button that immediately fails `captureRoom` is worse
 * than not showing it, per the house "no dead buttons" rule.
 *
 * `captureRoom` throws if the plugin is absent — callers gate on `roomScanPlugin()` (or
 * `roomScanAvailable()`) first; this is NOT best-effort work like `lib/native-bridge.ts`'s
 * `attempt()` — a scan the user explicitly started must not silently do nothing.
 */

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
 * (web, or bridge not yet injected), false when the plugin itself reports it is
 * unusable (no LiDAR, permission denied, etc.), and false if the availability check
 * itself throws or rejects — an availability probe that fails is not a "yes".
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
 * Run a native room scan. Throws if the plugin is absent — callers must gate on
 * `roomScanPlugin()` (presence) or, better, `roomScanAvailable()` (actually usable)
 * before calling this. Parses both JSON-string fields the plugin returns; invalid JSON
 * from the plugin surfaces as a named `RoomScanPayloadError` rather than being swallowed.
 */
export async function captureRoom(roomName: string): Promise<ParsedRoomScanResult> {
  const plugin = roomScanPlugin();
  if (!plugin) {
    throw new Error("MalletRoomScan plugin is not available — gate callers on roomScanAvailable()");
  }

  const result = await plugin.captureRoom({ roomName });
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
