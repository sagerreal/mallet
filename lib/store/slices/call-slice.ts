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
import { userMessage } from "@/lib/trpc/error-map";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { connectBrowserCall, hangUpBrowserCall, muteBrowserCall } from "@/lib/calls/browser-device";

/** The parts of an outbound-call DTO the bar reacts to. Structurally satisfied by the DTO itself. */
export interface CallStatusUpdate {
  status: string;
  startedAt: string | null;
  durationSec: number | null;
}

export interface CallSlice {
  activeCall: ActiveCall | null;
  /**
   * Opens the call bar for a lead and asks the server to place the call. Returns false if the
   * lead has no phone on file (a phoneless call would render a blank bar) — the LAST-LINE guard;
   * callers should gate the entry first (PhoneGate).
   *
   * The bar opens in "connecting" and STAYS there until an observed call status says otherwise.
   * A successful place() only means the provider accepted the request; the phone has not rung yet.
   */
  startCall: (leadId: string, transport?: "phone" | "browser") => boolean;
  /**
   * Applies a status read back from the server (the Twilio status webhook writes it). This is the
   * only thing that can make the bar "live" — see the note on `startCall`.
   */
  applyCallStatus: (callId: string, update: CallStatusUpdate) => void;
  tickCall: () => void;
  setCallNotes: (notes: string) => void;
  /** Silence our own microphone. Browser calls only; a no-op on a bridged one. */
  toggleCallMute: () => void;
  markCallEnded: () => void;
  clearCall: () => void;
}

// The call slice lives in the combined store, so it can read the leads slice via the shared
// get(). Typed as a minimal surface to avoid a store-wide type dep.
interface StoreWithLeads {
  leads: Lead[];
}

// Why a call ended without connecting. The status callback tracks LEG A — the leg Twilio rings
// first, which is the caller's OWN phone — so "no answer" means they missed their own callback,
// not that the customer did. Saying it the other way round would send them chasing the wrong thing.
const TERMINAL_REASON: Readonly<Record<string, string>> = {
  no_answer: "your phone wasn't answered",
  busy: "your line was busy",
  canceled: "the call was cancelled",
  failed: "the call didn't connect",
  // Client-originated, not a provider status: the bar waited and never saw the call connect.
  // Distinct from "no answer" on purpose — we genuinely do not know which happened.
  unconfirmed: "we never heard this call connect — try again",
};

/** The status the bar reports when it gives up waiting. Keyed into TERMINAL_REASON above. */
export const CALL_UNCONFIRMED = "unconfirmed";

const secondsSince = (startedAt: string | null): number => {
  if (!startedAt) return 0;
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((Date.now() - started) / 1000));
};

export const createCallSlice: StateCreator<CallSlice, [], [], CallSlice> = (set, get) => ({
  activeCall: null,

  startCall: (leadId, transport = "phone") => {
    const leads = (get() as unknown as StoreWithLeads).leads ?? [];
    const lead = leads.find((l) => l.id === leadId);
    // Refuse to open a blank call bar for a phoneless lead — the bar renders the number, so a
    // missing one dead-ends the UI (no silent no-op: caller gets false).
    if (!hasPhone(lead)) return false;

    set({
      activeCall: { leadId, sec: 0, notes: "", phase: "connecting", callId: null, error: null, transport, muted: false },
    });

    void trpcVanilla.v1.calls.place
      .mutate({ leadId, ...(transport === "browser" ? { transport } : {}) })
      .then(async (dto) => {
        // Record the id so the bar can poll for the real status. NOT "live": the row exists and
        // nothing has rung yet.
        // Guard against a stale response: the user may have hung up or started another call.
        const stillOurs = () => {
          const c = get().activeCall;
          return Boolean(c && c.leadId === leadId && c.phase === "connecting");
        };
        if (!stillOurs()) return;
        set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, callId: dto.id } } : {}));

        // A browser call is placed BY THIS BROWSER: the row is the reservation, and the device
        // connect below is what actually dials. Anything that fails here means no call happened,
        // so it surfaces in the bar rather than leaving a row that never rang.
        if (dto.transport !== "browser") return;
        try {
          const { token } = await trpcVanilla.v1.calls.browserToken.query();
          if (!stillOurs()) return;
          await connectBrowserCall(dto.id, token, {
            onDisconnect: () => get().markCallEnded(),
            onError: (message) =>
              set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, phase: "failed", error: message } } : {})),
          });
        } catch (e: unknown) {
          set((s) =>
            s.activeCall && s.activeCall.leadId === leadId
              ? { activeCall: { ...s.activeCall, phase: "failed", error: userMessage(e, "this browser could not carry the call") } }
              : {},
          );
        }
      })
      .catch((e: unknown) => {
        set((s) =>
          s.activeCall && s.activeCall.leadId === leadId && s.activeCall.phase === "connecting"
            ? {
                activeCall: {
                  ...s.activeCall,
                  phase: "failed",
                  // One seam for user-facing copy: a domain refusal keeps its actionable sentence,
                  // anything else becomes fixed copy so raw DB/provider text never reaches the bar.
                  error: userMessage(e, "the call could not be placed"),
                },
              }
            : {},
        );
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("calls.place failed", e);
        }
      });

    return true;
  },

  applyCallStatus: (callId, update) =>
    set((s) => {
      const call = s.activeCall;
      // Stale poll, a different call, or one the user has already finished with: leave it alone.
      // Terminal is final here for the same reason it is in the domain — a late status must not
      // rewrite an ending the user is already looking at.
      if (!call || call.callId !== callId || call.phase === "ended" || call.phase === "failed") {
        return {};
      }

      if (update.status === "in_progress") {
        return call.phase === "live"
          ? {}
          : { activeCall: { ...call, phase: "live", sec: secondsSince(update.startedAt) } };
      }

      if (update.status === "completed") {
        // The provider's duration is the true one; the local ticker only ever approximated it.
        return { activeCall: { ...call, phase: "ended", sec: update.durationSec ?? call.sec } };
      }

      const reason = TERMINAL_REASON[update.status];
      if (reason) return { activeCall: { ...call, phase: "failed", error: reason } };

      // queued/dialing — still ringing. An unrecognised value is left alone rather than guessed at.
      return {};
    }),

  // Only a bridged call is timed — a ringing or failed one has no duration.
  tickCall: () =>
    set((s) =>
      s.activeCall && s.activeCall.phase === "live"
        ? { activeCall: { ...s.activeCall, sec: s.activeCall.sec + 1 } }
        : {},
    ),

  setCallNotes: (notes) =>
    set((s) => (s.activeCall ? { activeCall: { ...s.activeCall, notes } } : {})),

  toggleCallMute: () =>
    set((s) => {
      if (!s.activeCall || s.activeCall.transport !== "browser") return {};
      const muted = !s.activeCall.muted;
      muteBrowserCall(muted);
      return { activeCall: { ...s.activeCall, muted } };
    }),

  markCallEnded: () =>
    set((s) => {
      if (!s.activeCall) return {};
      // Ending a browser call means actually hanging up the line, not just changing a label.
      if (s.activeCall.transport === "browser") hangUpBrowserCall();
      return { activeCall: { ...s.activeCall, phase: "ended" } };
    }),

  clearCall: () => {
    // Dismissing the bar must never leave a live line open behind it.
    hangUpBrowserCall();
    set({ activeCall: null });
  },
});
