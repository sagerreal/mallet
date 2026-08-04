"use client";

/**
 * features/settings/measurement-gate-provider.tsx
 *
 * Carries the SERVER-RESOLVED measurement gate (lib/auth/server-measurement-gate.ts) into the
 * client tree, and is the one place any surface reads the gate from.
 *
 * WHY A CONTEXT AND NOT A STORE SEED. The store is the right home for the LIVE value — the
 * hydrators write it, `setTrade` can grant it — but it cannot be right on the first paint. The
 * office/field pages are client components under SSR'd layouts, so the server renders their HTML
 * with whatever the store module holds at import time (`"unknown"`), the browser paints THAT, and
 * only then does React hydrate and any seed run. Seeding the store from an effect therefore still
 * shows the Measure card to a plumbing shop for a frame. Writing per-request data into the store
 * on the server is not an option either — it is a module singleton shared across requests.
 *
 * A context value passed down from the layout is rendered identically on the server and on the
 * first client render, so the HTML is already correct: no flash, no hydration mismatch.
 *
 * THE MERGE RULE. `useMeasurementGate()` prefers the STORE once it holds a real answer and falls
 * back to the server seed while it is `"unknown"`:
 *
 *   store "unknown" → the seed          (first paint, and every paint if no hydrator has landed)
 *   store on/off    → the store         (a hydrator read, or `setTrade` granting measuring)
 *
 * so the freshest answer always wins and neither source can be silently dropped. Both being
 * `"unknown"` means what it says — the server read failed AND no client read has landed — and the
 * surfaces fail OPEN into a disabled control with a stated reason (see scan-unavailable.tsx).
 *
 * Default `"unknown"`: a tree with no provider (none today) degrades to the previous behaviour
 * rather than to a fabricated `"off"`.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { MeasurementGate } from "@/lib/measurement-gate";

const MeasurementGateContext = createContext<MeasurementGate>("unknown");

export function MeasurementGateProvider({
  gate,
  children,
}: {
  gate: MeasurementGate;
  children: ReactNode;
}) {
  return <MeasurementGateContext.Provider value={gate}>{children}</MeasurementGateContext.Provider>;
}

/**
 * The gate for this org, server-seeded and kept current by the settings hydrators. Read this
 * rather than `store.toggles.measurementEstimating` — the raw store value is `"unknown"` on the
 * first paint of every cold load and would reintroduce the flash.
 */
export function useMeasurementGate(): MeasurementGate {
  const seeded = useContext(MeasurementGateContext);
  const stored = useAppStore((s) => s.toggles.measurementEstimating);
  return stored === "unknown" ? seeded : stored;
}
