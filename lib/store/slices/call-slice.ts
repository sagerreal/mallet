/**
 * lib/store/slices/call-slice.ts
 * Live call state for the global call bar.
 *
 * The call is REAL: startCall asks the server to place a two-leg outbound call (Twilio rings
 * the user's own mobile, then bridges the customer with the org's business line as caller ID).
 * The bar reflects that lifecycle rather than simulating one — it was previously a local
 * stopwatch that placed no call at all.
 */

import type { StateCreator } from "zustand";
import type { ActiveCall, Lead } from "../types";
import { hasPhone } from "@/lib/phone";
import { trpcVanilla } from "@/lib/trpc/vanilla";

export interface CallSlice {
  activeCall: ActiveCall | null;
  /**
   * Opens the call bar for a lead and asks the server to place the call. Returns false if the
   * lead has no phone on file (a phoneless call would render a blank bar) — the LAST-LINE guard;
   * callers should gate the entry first (PhoneGate).
   *
   * The bar opens in "connecting" and moves to "live" or "failed" when the server answers.
   */
  startCall: (leadId: string) => boolean;
  tickCall: () => void;
  setCallNotes: (notes: string) => void;
  markCallEnded: () => void;
  clearCall: () => void;
}

// The call slice lives in the combined store, so it can read the leads slice via the shared
// get(). Typed as a minimal surface to avoid a store-wide type dep.
interface StoreWithLeads {
  leads: Lead[];
}

const placeFailedMessage = (e: unknown): string =>
  e instanceof Error && e.message.trim().length > 0 ? e.message : "the call could not be placed";

export const createCallSlice: StateCreator<CallSlice, [], [], CallSlice> = (set, get) => ({
  activeCall: null,

  startCall: (leadId) => {
    const leads = (get() as unknown as StoreWithLeads).leads ?? [];
    const lead = leads.find((l) => l.id === leadId);
    // Refuse to open a blank call bar for a phoneless lead — the bar renders the number, so a
    // missing one dead-ends the UI (no silent no-op: caller gets false).
    if (!hasPhone(lead)) return false;

    set({ activeCall: { leadId, sec: 0, notes: "", phase: "connecting", callId: null, error: null } });

    void trpcVanilla.v1.calls.place
      .mutate({ leadId })
      .then((dto) => {
        // Guard against a stale response: the user may have hung up or started another call.
        set((s) =>
          s.activeCall && s.activeCall.leadId === leadId && s.activeCall.phase === "connecting"
            ? { activeCall: { ...s.activeCall, phase: "live", callId: dto.id } }
            : {},
        );
      })
      .catch((e: unknown) => {
        set((s) =>
          s.activeCall && s.activeCall.leadId === leadId && s.activeCall.phase === "connecting"
            ? { activeCall: { ...s.activeCall, phase: "failed", error: placeFailedMessage(e) } }
            : {},
        );
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("calls.place failed", e);
        }
      });

    return true;
  },

  // Only a bridged call is timed — a ringing or failed one has no duration.
  tickCall: () =>
    set((s) =>
      s.activeCall && s.activeCall.phase === "live"
        ? { activeCall: { ...s.activeCall, sec: s.activeCall.sec + 1 } }
        : {},
    ),

  setCallNotes: (notes) =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, notes } } : {})),

  markCallEnded: () =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, phase: "ended" } } : {})),

  clearCall: () => set({ activeCall: null }),
});
