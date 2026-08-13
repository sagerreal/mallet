/**
 * lib/native/tap-to-pay.ts
 * The ONE place that knows the `MalletTapToPay` native plugin's contract — the phone-as-reader
 * half of Tap to Pay (Stripe Terminal). Mirrors lib/native/room-scan.ts, the repo's pattern for
 * native-gated capabilities: everything upstream (the close-out pay block) goes through the
 * exports here instead of touching `nativePlugin` directly.
 *
 * THE PLUGIN DOES NOT EXIST YET. This PR ships the server plumbing and this probe; the native
 * plugin (Terminal SDK: discover/connect the local mobile reader, collect + confirm) is the next
 * app-shell PR — its contract is written down in
 * docs/superpowers/specs/2026-08-12-tap-to-pay-native-plugin-design.md. Until it ships, the probe
 * can only ever answer `no-native-app` (browser) or `plugin-missing` (shell), and the UI renders
 * the affordance DISABLED with that reason — the same honesty contract as room scanning: hiding
 * the control is an unexplained absence, a live control would be a lie.
 *
 * Availability is a discriminated union, not a boolean, because every "no" is a different
 * sentence to the user (components/shared/tap-to-pay-unavailable.tsx owns the copy):
 *   1. Is the Capacitor bridge here at all (`isNativeShell()`)? → `no-native-app` in any browser.
 *   2. Is `MalletTapToPay` registered on the bridge? The shell registers plugins from a static
 *      manifest, so a build without the entry has a bridge and no reader. → `plugin-missing`.
 *   3. Does the plugin's own `available()` say yes? That reflects only the NATIVE device gate
 *      (Tap to Pay needs a recent iPhone and iOS). → `unsupported-device` when it answers no.
 */

import { useEffect, useState } from "react";
import { isNativeShell, nativePlugin } from "@/lib/native-bridge";

const PLUGIN_NAME = "MalletTapToPay";

/**
 * The probe half of the future plugin's surface. `available()` answers the DEVICE question only
 * (hardware/OS support), never permissions or Stripe state — identical division of labor to
 * MalletRoomScan.available(). The collect/confirm methods are specified in the PR2 contract and
 * deliberately NOT typed here yet: typing calls this version can never make would be decoration.
 */
export interface TapToPayPlugin {
  available(): Promise<{ available: boolean; reason?: string }>;
  /**
   * Has this shop accepted Apple's Tap to Pay Terms & Conditions?
   *
   * Apple 1.6: "For the status of whether a merchant has accepted Tap to Pay on iPhones,
   * retrieve it from Apple instead of storing it in a local variable in your app." So this is
   * asked of the SDK every time it is needed and NEVER persisted — not in org_settings, not in
   * the store, not in a ref. A cached yes survives a merchant revoking acceptance on another
   * device and would put a live reader in front of terms nobody currently accepts.
   */
  termsAccepted(): Promise<{ accepted: boolean }>;
}

/** The named native plugin, or null on the web / before the bridge is injected. */
export function tapToPayPlugin(): TapToPayPlugin | null {
  return nativePlugin<TapToPayPlugin>(PLUGIN_NAME);
}

/**
 * Why Tap to Pay can or cannot run right now.
 *
 *  - `ready`              — bridge + plugin + supported device. (Unreachable until the plugin
 *                           ships; the PR1 UI still renders it DISABLED — see the component.)
 *  - `checking`           — the one-time probe is still in flight. Hook-only, transient.
 *  - `no-native-app`      — no Capacitor bridge: a browser cannot read a card.
 *  - `plugin-missing`     — bridge present, plugin absent (this app version) or its probe
 *                           rejected/hung. The PR1 steady state in the shell.
 *  - `unsupported-device` — the plugin says this iPhone/iOS cannot take Tap to Pay.
 */
export type TapToPayAvailability =
  | { readonly status: "ready" }
  | { readonly status: "checking" }
  | { readonly status: "no-native-app" }
  | { readonly status: "plugin-missing" }
  | { readonly status: "unsupported-device" };

const READY: TapToPayAvailability = Object.freeze({ status: "ready" as const });
const CHECKING: TapToPayAvailability = Object.freeze({ status: "checking" as const });
const NO_NATIVE_APP: TapToPayAvailability = Object.freeze({ status: "no-native-app" as const });
const PLUGIN_MISSING: TapToPayAvailability = Object.freeze({ status: "plugin-missing" as const });
const UNSUPPORTED: TapToPayAvailability = Object.freeze({ status: "unsupported-device" as const });

/**
 * How long the native `available()` probe gets before we stop waiting on it. Same bound and same
 * reasoning as ROOM_SCAN_PROBE_TIMEOUT_MS: a promise that never settles must not leave the
 * control on "Checking…" for the rest of the session.
 */
export const TAP_TO_PAY_PROBE_TIMEOUT_MS = 2000;

/**
 * Ask, in order: is there a bridge, is the plugin on it, does the plugin say the device can take
 * a tap. Never throws and never returns `checking`. A probe that rejects or times out is
 * `plugin-missing` — a reader that cannot answer for itself is not a yes, and it is a
 * build/session fault rather than a device fact.
 */
export async function tapToPayAvailability(): Promise<TapToPayAvailability> {
  if (!isNativeShell()) return NO_NATIVE_APP;
  const plugin = tapToPayPlugin();
  if (!plugin) return PLUGIN_MISSING;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      plugin.available(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("MalletTapToPay available() timed out")),
          TAP_TO_PAY_PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return result.available ? READY : UNSUPPORTED;
  } catch {
    return PLUGIN_MISSING;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Module-level cache, shared probe, and a bounded retry for the one transient status — the same
// machinery as room-scan.ts, for the same reasons (see settleProbe there for the full history:
// an uncached transient answer must not latch for the session, and the retry budget must count
// PROBES, not subscribers).
let cachedAvailability: TapToPayAvailability | null = null;
let availabilityProbe: Promise<TapToPayAvailability> | null = null;
let pluginMissingAttempts = 0;

/**
 * `plugin-missing` covers a probe that rejected or timed out, which a bridge still coming up can
 * do once — so it gets this many probes before the answer is cached for the session. Every other
 * status is a settled fact and caches immediately.
 */
export const TAP_TO_PAY_PROBE_MAX_ATTEMPTS = 3;

/** Test-only: clears the module-level availability cache between test cases. */
export function resetTapToPayAvailabilityCache(): void {
  cachedAvailability = null;
  availabilityProbe = null;
  pluginMissingAttempts = 0;
}

/** Book ONE probe's answer against the cache and the retry budget (see room-scan.settleProbe). */
function settleProbe(probe: Promise<TapToPayAvailability>, result: TapToPayAvailability): void {
  if (availabilityProbe !== probe) return;
  if (result.status === "plugin-missing" && pluginMissingAttempts + 1 < TAP_TO_PAY_PROBE_MAX_ATTEMPTS) {
    pluginMissingAttempts += 1;
    availabilityProbe = null;
    return;
  }
  cachedAvailability = result;
}

/**
 * React hook wrapping `tapToPayAvailability()`. Starts at `checking` — NOT at a guess — so the
 * first render is identical on the server and the client (no hydration mismatch) and no user is
 * ever told the wrong reason. Callers render the affordance in every state.
 */
export function useTapToPayAvailability(): TapToPayAvailability {
  const [availability, setAvailability] = useState<TapToPayAvailability>(
    cachedAvailability ?? CHECKING,
  );

  useEffect(() => {
    if (cachedAvailability !== null) {
      setAvailability(cachedAvailability);
      return;
    }
    if (!availabilityProbe) {
      availabilityProbe = tapToPayAvailability();
    }
    const probe = availabilityProbe;
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

/**
 * Whether the shop has accepted Apple's terms — asked of the SDK, never cached (1.6).
 *
 * `null` means "not answerable here": no bridge, no plugin, or the probe failed. Callers treat
 * null as not-enabled, which routes a tap into the T&C flow rather than into a reader that would
 * refuse — the safe direction under 5.3.
 */
export async function tapToPayTermsAccepted(): Promise<boolean | null> {
  const plugin = tapToPayPlugin();
  if (!plugin?.termsAccepted) return null;
  try {
    const { accepted } = await plugin.termsAccepted();
    return accepted;
  } catch {
    return null;
  }
}

/**
 * The live terms-acceptance answer for a component.
 *
 * Re-asks on every mount and whenever the app returns to the foreground: acceptance can change
 * on another device or be revoked in iOS Settings, and 1.6 exists precisely because a remembered
 * answer goes stale silently.
 */
export function useTapToPayTermsAccepted(): boolean {
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ask = () => {
      void tapToPayTermsAccepted().then((result) => {
        if (!cancelled) setAccepted(result === true);
      });
    };
    ask();
    // Foreground is when acceptance most plausibly changed — the merchant was just in Settings.
    const onVisible = () => {
      if (document.visibilityState === "visible") ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return accepted;
}
