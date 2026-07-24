/**
 * lib/store/slices/a2p-slice.ts
 * Read-only projection of the org's A2P 10DLC registration status. Populated by
 * A2pHydrator (features/a2p/a2p-hydrator.tsx) from v1.a2p.getStatus — there is no
 * client-side mutation path here (registration itself is driven by the a2p
 * onboarding flow's own mutation calls, not this slice). Mirrors the read-only
 * half of settings-slice's hydration pattern (setSettings), scoped down to a
 * single field since there's nothing else to hold yet.
 */

import type { StateCreator } from "zustand";
import type { A2pStatusView } from "@mallet/a2p";

export interface A2pSlice {
  /** null until A2pHydrator's first successful load. */
  a2pStatus: A2pStatusView | null;

  /** Replace the status view — called by A2pHydrator. */
  setA2pStatus: (view: A2pStatusView) => void;
}

export const createA2pSlice: StateCreator<A2pSlice, [], [], A2pSlice> = (set) => ({
  a2pStatus: null,

  setA2pStatus: (view) => set({ a2pStatus: view }),
});
