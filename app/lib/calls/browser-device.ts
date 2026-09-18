"use client";

/**
 * lib/calls/browser-device.ts
 * The softphone: Mallet carrying the call itself, through this browser's microphone.
 *
 * Everything Twilio-SDK-shaped lives behind this module. The SDK is loaded on FIRST USE, not at
 * import — it is ~100KB that a person who never presses Call should not pay for, and it touches
 * `window` at module scope, which breaks the server render of anything importing it eagerly.
 *
 * The Device and the live Call are module singletons rather than store state on purpose: they are
 * stateful objects with listeners and a native peer connection, and the Zustand store holds plain
 * serialisable data. The store keeps the FACTS about the call (phase, transport, muted); this
 * module keeps the thing making the noise.
 */

import type { Call, Device } from "@twilio/voice-sdk";

let device: Device | null = null;
let active: Call | null = null;

export interface BrowserCallHandlers {
  /** The far end hung up, or we did — either way the call is over. */
  readonly onDisconnect: () => void;
  /** The call could not be carried. The message is already user-facing. */
  readonly onError: (message: string) => void;
}

/**
 * Can this browser carry a call at all?
 *
 * Deliberately answered WITHOUT loading the SDK — the point is to decide before paying for it.
 * Two questions:
 *   - is there WebRTC and a microphone API to use;
 *   - is this a touch-primary device.
 *
 * The second is not snobbery about phones. A mobile browser suspends WebRTC when the screen locks
 * or the tab backgrounds, which is exactly what a phone in a pocket between houses does. Carrying
 * a technician's call in a tab that the OS is entitled to kill would drop calls in the field, so
 * those go down the phone bridge, which rings the handset the OS is actually protecting.
 */
export function browserCallingSupported(): boolean {
  if (typeof window === "undefined") return false;
  const hasWebRtc = typeof window.RTCPeerConnection !== "undefined";
  const hasMic = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
  const touchPrimary = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return hasWebRtc && hasMic && !touchPrimary;
}

/**
 * Connects this browser to a call that ALREADY EXISTS as a row. The id is the only thing sent to
 * the provider; the customer's number is re-read server-side when Twilio asks us for instructions
 * (see app/api/voice/browser/route.ts), so a client can never dial a number of its choosing.
 */
export async function connectBrowserCall(
  callId: string,
  token: string,
  handlers: BrowserCallHandlers,
): Promise<void> {
  const { Device: TwilioDevice } = await import("@twilio/voice-sdk");

  // One Device per token. Re-creating it per call keeps the credential short-lived and avoids
  // holding a registered device open between calls.
  await teardown();
  device = new TwilioDevice(token, { logLevel: "error" });

  device.on("error", (e: { message?: string }) => {
    handlers.onError(e?.message?.trim() ? "the call could not be carried by this browser" : "the call could not be placed");
  });

  active = await device.connect({ params: { callId } });
  active.on("disconnect", () => {
    void teardown();
    handlers.onDisconnect();
  });
  active.on("cancel", () => {
    void teardown();
    handlers.onDisconnect();
  });
}

/** Silence our microphone. The far end stays audible — this is not hold. */
export function muteBrowserCall(muted: boolean): void {
  active?.mute(muted);
}

/** Touch-tones, for phone trees. */
export function sendBrowserDigits(digits: string): void {
  active?.sendDigits(digits);
}

/** Hang up from our end. The disconnect handler does the rest. */
export function hangUpBrowserCall(): void {
  active?.disconnect();
}

/** True when this browser is currently carrying a call. */
export function hasActiveBrowserCall(): boolean {
  return active !== null;
}

async function teardown(): Promise<void> {
  active = null;
  if (!device) return;
  const dying = device;
  device = null;
  try {
    dying.disconnectAll();
    dying.destroy();
  } catch {
    // Destroying an already-dead device must never take a call flow down with it.
  }
}
