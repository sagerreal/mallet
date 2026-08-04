/**
 * lib/native/room-scan.ts
 * The ONE place that knows the `MalletRoomScan` native plugin's contract. Everything
 * upstream (the measurements store slice, the scan UI) goes through the exports here
 * instead of touching `nativePlugin` directly.
 *
 * Availability is not a yes/no — the DIFFERENT WAYS it can be "no" are what the UI has to
 * say out loud, so `roomScanAvailability()` returns a discriminated `RoomScanAvailability`
 * rather than a boolean. Three separate facts get asked, in this order:
 *   1. Is the Capacitor bridge here at all (`isNativeShell()`)? False in every browser,
 *      desktop or mobile — the bridge is injected by a `WKUserScript` scoped to the shell's
 *      webview, so app.trymallet.com in Safari never has it. → `no-native-app`.
 *   2. Is the `MalletRoomScan` plugin registered on that bridge (`roomScanPlugin()`)? The
 *      shell registers it from a static manifest, so a shell build that forgot the entry has
 *      a bridge but no scanner. → `scanner-missing`.
 *   3. Does the plugin's own `available()` say yes? That call returns
 *      `{ available: boolean, reason?: string }` and reflects only the NATIVE device gate
 *      (`RoomCaptureSession.isSupported`, i.e. LiDAR) — false on any non-Pro iPhone.
 *      → `no-lidar`. It does NOT check Camera permission: a LiDAR phone whose user denied
 *      Camera still reports `available: true`, and that denial surfaces later as a
 *      `captureRoom` rejection when the native session tries to start.
 *
 * The `reason` string `available()` may return is deliberately NOT surfaced — it is a native
 * diagnostic code, not user copy. The user-facing wording for each status lives in one place,
 * `components/shared/scan-unavailable.tsx`.
 *
 * WHY THE UI RENDERS EVERY STATUS INSTEAD OF HIDING. Hiding the scan entry point whenever it
 * could not run made the app's one native capability invisible to anyone on a non-Pro iPhone
 * or in a browser — including an App Review reviewer, who then sees no native functionality
 * at all (guideline 4.2), and including us, testing in a browser and concluding it broke. So
 * callers render the affordance in ALL states and DISABLE it with its reason when it cannot
 * run. That is not a dead button: a dead button is one that claims it works and does nothing.
 *
 * `captureRoom` throws if the plugin is absent — callers gate on `roomScanAvailability()`
 * first; this is NOT best-effort work like `lib/native-bridge.ts`'s `attempt()` — a scan the
 * user explicitly started must not silently do nothing.
 */

import { useEffect, useState } from "react";
import { isNativeShell, nativePlugin } from "@/lib/native-bridge";

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
 * Why room scanning can or cannot run right now. Every "no" is a DIFFERENT sentence to the
 * user, which is the whole reason this is a union and not a boolean:
 *
 *  - `ready`           — bridge here, plugin registered, device supports RoomPlan. Scan away.
 *  - `checking`        — the one-time native probe is still in flight. Only ever transient,
 *                        and only inside the shell.
 *  - `no-lidar`        — the plugin answered `available: false`: this iPhone/iPad has no LiDAR
 *                        sensor. The user needs a different DEVICE.
 *  - `no-native-app`   — no Capacitor bridge: a browser. The user needs the iPhone APP.
 *  - `scanner-missing` — bridge present but the plugin is not registered on it, or its own
 *                        `available()` call rejected. A probe that fails is not a "yes", and
 *                        this is a build/session fault rather than anything about the device.
 */
export type RoomScanAvailability =
  | { readonly status: "ready" }
  | { readonly status: "checking" }
  | { readonly status: "no-lidar" }
  | { readonly status: "no-native-app" }
  | { readonly status: "scanner-missing" };

/** Every status EXCEPT `ready` — what `ScanUnavailable` accepts, so `ready` can't reach it. */
export type BlockedRoomScanAvailability = Exclude<RoomScanAvailability, { status: "ready" }>;

const READY: RoomScanAvailability = Object.freeze({ status: "ready" as const });
const CHECKING: RoomScanAvailability = Object.freeze({ status: "checking" as const });
const NO_LIDAR: RoomScanAvailability = Object.freeze({ status: "no-lidar" as const });
const NO_NATIVE_APP: RoomScanAvailability = Object.freeze({ status: "no-native-app" as const });
const SCANNER_MISSING: RoomScanAvailability = Object.freeze({ status: "scanner-missing" as const });

/**
 * How long the native `available()` probe gets before we stop waiting on it.
 *
 * `RoomCaptureSession.isSupported` is a local capability check, so the real call answers in
 * single-digit milliseconds; this bound exists for the case where it answers NEVER. A promise
 * that stays unsettled left `useRoomScanAvailability` on `checking` for the rest of the session,
 * which renders as a permanently disabled control reading "Checking whether this device can
 * scan." — a dead affordance with a sentence that says to wait, forever. Two seconds is far
 * beyond any honest answer and short enough that a reviewer never sees the interim state.
 */
export const ROOM_SCAN_PROBE_TIMEOUT_MS = 2000;

/**
 * Ask, in order: is there a bridge, is the plugin on it, does the plugin say the device can
 * scan. Never throws and never returns `checking` — `checking` is a hook-only state describing
 * this promise being unsettled. A probe that neither resolves nor rejects within
 * `ROOM_SCAN_PROBE_TIMEOUT_MS` is treated exactly like one that rejected: a scanner that cannot
 * answer for itself is not a yes, and it is a build/session fault rather than a device fact.
 */
export async function roomScanAvailability(): Promise<RoomScanAvailability> {
  if (!isNativeShell()) return NO_NATIVE_APP;
  const plugin = roomScanPlugin();
  if (!plugin) return SCANNER_MISSING;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      plugin.available(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("MalletRoomScan available() timed out")), ROOM_SCAN_PROBE_TIMEOUT_MS);
      }),
    ]);
    return result.available ? READY : NO_LIDAR;
  } catch {
    return SCANNER_MISSING;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Module-level cache: whether this device can scan does not change mid-session, so the probe
// runs once for the app's lifetime rather than once per mount — every quote-tab /
// measured-surfaces-panel / room-card-modal instance shares the same in-flight promise
// instead of firing its own native round trip.
let cachedRoomScanAvailability: RoomScanAvailability | null = null;
let roomScanAvailabilityProbe: Promise<RoomScanAvailability> | null = null;
let scannerMissingAttempts = 0;

/**
 * How many times a `scanner-missing` answer is allowed to be re-probed before it is taken as
 * final.
 *
 * `scanner-missing` is the ONLY status that can be transient: it covers a probe that rejected or
 * timed out, which a bridge still coming up can do once. Every other status is a settled fact
 * (there is no bridge; the device has no LiDAR; it works). Caching the first answer unconditionally
 * meant one unlucky rejection latched "the scanner is missing" for the entire session, with no way
 * back short of a reload — a permanent wrong answer from a momentary one. So a `scanner-missing`
 * result is not cached until it has happened this many times, and after that it is, because a
 * shell built without the plugin will never answer differently and re-probing it on every mount
 * is just noise.
 */
export const ROOM_SCAN_PROBE_MAX_ATTEMPTS = 3;

/** Test-only: clears the module-level availability cache between test cases. */
export function resetRoomScanAvailabilityCache(): void {
  cachedRoomScanAvailability = null;
  roomScanAvailabilityProbe = null;
  scannerMissingAttempts = 0;
}

/**
 * Book ONE probe's answer against the module cache and the retry budget.
 *
 * WHY THIS IS A FUNCTION AND NOT INLINE IN THE HOOK'S `.then`. The probe promise is SHARED —
 * that is the whole point of caching it — so every mounted consumer runs its own `.then` on the
 * same promise. The bookkeeping used to live in that callback, which meant the budget counted
 * SUBSCRIBERS rather than probes: three surfaces mounted together (the composer's panel, a room
 * card and the field Quote tab all do) turned one rejected probe into three attempts, exhausted
 * ROOM_SCAN_PROBE_MAX_ATTEMPTS on the first try and cached `scanner-missing` for the session —
 * the exact session-long latch the retry exists to prevent. Only tests, which mount one consumer
 * at a time, never saw it.
 *
 * `roomScanAvailabilityProbe === probe` is the "I am the first callback for THIS probe" guard:
 * the retry path clears the shared promise, so every later subscriber on the same probe fails the
 * guard and books nothing. One probe now costs exactly one attempt, whatever is on screen.
 */
function settleProbe(probe: Promise<RoomScanAvailability>, result: RoomScanAvailability): void {
  if (roomScanAvailabilityProbe !== probe) return;
  // A transient `scanner-missing` gets a bounded retry rather than latching for the session —
  // see ROOM_SCAN_PROBE_MAX_ATTEMPTS. Clearing the shared promise (not the answer) means the
  // NEXT mount re-probes; the mounts already on screen still show the honest current answer.
  if (result.status === "scanner-missing" && scannerMissingAttempts + 1 < ROOM_SCAN_PROBE_MAX_ATTEMPTS) {
    scannerMissingAttempts += 1;
    roomScanAvailabilityProbe = null;
    return;
  }
  cachedRoomScanAvailability = result;
}

/**
 * React hook wrapping `roomScanAvailability()`. Starts at `checking` — NOT at a guess — so the
 * first render is identical on the server and the client (reading `window` in the initial state
 * would be a hydration mismatch) and so no user is ever told the wrong reason. Callers render
 * the scan affordance in every state; `checking` resolves in the tick after mount.
 */
export function useRoomScanAvailability(): RoomScanAvailability {
  const [availability, setAvailability] = useState<RoomScanAvailability>(
    cachedRoomScanAvailability ?? CHECKING,
  );

  useEffect(() => {
    if (cachedRoomScanAvailability !== null) {
      setAvailability(cachedRoomScanAvailability);
      return;
    }
    if (!roomScanAvailabilityProbe) {
      roomScanAvailabilityProbe = roomScanAvailability();
    }
    const probe = roomScanAvailabilityProbe;
    let cancelled = false;
    void probe.then((result) => {
      settleProbe(probe, result);
      if (!cancelled) setAvailability(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return availability;
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
 * `roomScanAvailability()` returning `ready` before calling this (`roomScanPlugin()` presence
 * alone is not enough). Parses both JSON-string fields the plugin returns; invalid JSON
 * from the plugin surfaces as a named `RoomScanPayloadError` rather than being swallowed.
 * A rejection from the native `captureRoom` call itself (as opposed to a JSON-parse failure
 * on its result) surfaces as a named `RoomScanCaptureError` carrying the native message.
 */
export async function captureRoom(roomName: string): Promise<ParsedRoomScanResult> {
  const plugin = roomScanPlugin();
  if (!plugin) {
    throw new Error("MalletRoomScan plugin is not available — gate callers on roomScanAvailability()");
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
