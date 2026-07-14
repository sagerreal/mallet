/**
 * lib/store/slices/call-slice.ts
 * Live call state for the global call bar (prototype state.activeCall).
 * The bar persists after the Call modal closes; finish-logic lives in the
 * CallBar component so this slice stays decoupled from the leads slice.
 */

import type { StateCreator } from "zustand";
import type { ActiveCall, Lead } from "../types";
import { hasPhone } from "@/lib/phone";

export interface CallSlice {
  activeCall: ActiveCall | null;
  /**
   * Opens the live call bar for a lead. Returns true if the call started, false
   * if the lead has no phone on file (a phoneless call would render a blank call
   * bar). This is the LAST-LINE guard — callers should gate the entry first
   * (PhoneGate) — but startCall never opens a blank bar regardless of the opener.
   */
  startCall: (leadId: string) => boolean;
  tickCall: () => void;
  setCallNotes: (notes: string) => void;
  markCallEnded: () => void;
  clearCall: () => void;
}

// The call slice lives in the combined store, so it can read the leads slice via
// the shared get(). Typed as a minimal surface to avoid a store-wide type dep.
interface StoreWithLeads {
  leads: Lead[];
}

export const createCallSlice: StateCreator<CallSlice, [], [], CallSlice> = (set, get) => ({
  activeCall: null,

  startCall: (leadId) => {
    const leads = (get() as unknown as StoreWithLeads).leads ?? [];
    const lead = leads.find((l) => l.id === leadId);
    // Refuse to open a blank call bar for a phoneless lead — the bar renders the
    // number, so a missing one dead-ends the UI (no silent no-op: caller gets false).
    if (!hasPhone(lead)) return false;
    set({ activeCall: { leadId, sec: 0, notes: "", phase: "live" } });
    return true;
  },

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
