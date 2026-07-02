/**
 * lib/store/slices/call-slice.ts
 * Live call state for the global call bar (prototype state.activeCall).
 * The bar persists after the Call modal closes; finish-logic lives in the
 * CallBar component so this slice stays decoupled from the leads slice.
 */

import type { StateCreator } from "zustand";
import type { ActiveCall } from "../types";

export interface CallSlice {
  activeCall: ActiveCall | null;
  startCall: (leadId: number) => void;
  tickCall: () => void;
  setCallNotes: (notes: string) => void;
  markCallEnded: () => void;
  clearCall: () => void;
}

export const createCallSlice: StateCreator<CallSlice, [], [], CallSlice> = (set) => ({
  activeCall: null,

  startCall: (leadId) =>
    set({ activeCall: { leadId, sec: 0, notes: "", phase: "live" } }),

  tickCall: () =>
    set((s) =>
      s.activeCall && s.activeCall.phase === "live"
        ? { activeCall: { ...s.activeCall, sec: s.activeCall.sec + 1 } }
        : {}
    ),

  setCallNotes: (notes) =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, notes } } : {})),

  markCallEnded: () =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, phase: "ended" } } : {})),

  clearCall: () => set({ activeCall: null }),
});
