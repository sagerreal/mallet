"use client";

/**
 * lib/haptics.ts
 * Physical feedback for actions that changed something, when running inside the
 * native shell. A no-op everywhere else.
 *
 * Haptics is the clearest single difference between "a web page behind an app icon"
 * and an app. There were zero haptic call sites before this.
 *
 * SILENCE IS CORRECT HERE. A browser has no Taptic Engine, and the plugin rejects
 * when the user has System Haptics switched off — their setting, not our error. A
 * dead buzz must never break the write that triggered it, so every call goes through
 * `attempt` (see lib/native-bridge.ts for why that exception is allowed).
 *
 * Strings, not an enum, because we bypass the typed client: @capacitor/haptics
 * declares ImpactStyle as "LIGHT"/"MEDIUM"/"HEAVY" and NotificationType as
 * "SUCCESS"/"WARNING"/"ERROR". lib/haptics.test.ts is what holds that contract.
 */

import { attempt } from "./native-bridge";

interface HapticsBridge {
  impact?: (options: { style: string }) => Promise<void>;
  notification?: (options: { type: string }) => Promise<void>;
}

const HAPTICS = "Haptics";

export const haptics = {
  /** A selection or toggle — the lightest possible confirmation that a tap landed. */
  tap(): void {
    attempt<HapticsBridge>(HAPTICS, (p) => p.impact?.({ style: "LIGHT" }));
  },
  /** Something was WRITTEN: a status moved, a clock started, a line was saved. */
  commit(): void {
    attempt<HapticsBridge>(HAPTICS, (p) => p.impact?.({ style: "MEDIUM" }));
  },
  /** A task finished: money recorded, job closed out, quote sent. */
  success(): void {
    attempt<HapticsBridge>(HAPTICS, (p) => p.notification?.({ type: "SUCCESS" }));
  },
  /** Something needs the user's attention before it can proceed. */
  warn(): void {
    attempt<HapticsBridge>(HAPTICS, (p) => p.notification?.({ type: "WARNING" }));
  },
};
