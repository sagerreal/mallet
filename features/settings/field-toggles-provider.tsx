"use client";

/**
 * features/settings/field-toggles-provider.tsx
 *
 * One wrapper for the one server read. `v1.settings.fieldToggles` answers both of the org's field
 * capability flags in a single anyRole query, the layouts resolve it per request
 * (lib/auth/server-field-toggles.ts), and this carries the whole seed into the client tree so the
 * first HTML is already the right shape.
 *
 * The two flags keep SEPARATE contexts behind this because they fail opposite ways and their
 * readers are unrelated — the scan surfaces fail open on `"unknown"`, Text fails closed. Merging
 * them into one context value would make every reader re-render on the other's change and invite
 * exactly the "one gate for everything" flattening the tri-state note in lib/measurement-gate.ts
 * warns about.
 */

import type { ReactNode } from "react";
import { MeasurementGateProvider } from "@/features/settings/measurement-gate-provider";
import { CanTextProvider } from "@/features/messaging/use-can-text";
import type { FieldTogglesSeed } from "@/lib/field-toggles-seed";

export function FieldTogglesProvider({
  seed,
  children,
}: {
  seed: FieldTogglesSeed;
  children: ReactNode;
}) {
  return (
    <MeasurementGateProvider gate={seed.measurement}>
      <CanTextProvider seed={seed.canText}>{children}</CanTextProvider>
    </MeasurementGateProvider>
  );
}
