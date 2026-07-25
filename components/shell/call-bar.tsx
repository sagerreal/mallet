/**
 * components/shell/call-bar.tsx
 * Global live-call bar. Mounted once app-wide; persists after the Call modal closes.
 *
 * Reflects a REAL call: "connecting" while Twilio rings your own phone, "live" once the
 * customer is bridged (only then does the timer run), "failed" when the call was never placed,
 * and "ended" for the disposition chips. The disposition is persisted server-side, so the log
 * survives a refresh.
 */

"use client";

import { useEffect } from "react";
import { useAppStore, useActiveCall } from "@/lib/store/app-store";
import { CALL_OUTCOMES } from "@/lib/store/call-constants";
import { trpcVanilla } from "@/lib/trpc/vanilla";

function cbFmt(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CallBar() {
  const activeCall = useActiveCall();
  const tickCall = useAppStore((s) => s.tickCall);
  const setCallNotes = useAppStore((s) => s.setCallNotes);
  const markCallEnded = useAppStore((s) => s.markCallEnded);
  const clearCall = useAppStore((s) => s.clearCall);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const leads = useAppStore((s) => s.leads);

  const isLive = activeCall?.phase === "live";
  useEffect(() => {
    if (!isLive) return;
    const t = setInterval(() => tickCall(), 1000);
    return () => clearInterval(t);
  }, [isLive, tickCall]);

  if (!activeCall) return null;
  const call = activeCall;
  const lead = leads.find((l) => l.id === call.leadId);
  if (!lead) return null;

  function finish(outcome: string) {
    // Timeline note for the current session…
    addLeadNote(call.leadId, {
      type: "call",
      dir: "out",
      outcome,
      dur: cbFmt(call.sec),
      via: "mallet",
      when: "Just now",
      notes: call.notes.trim(),
    });
    // …and the durable record. Without this the disposition dies on refresh, which is exactly
    // what the old simulated bar did to every call it ever claimed to log.
    if (call.callId) {
      void trpcVanilla.v1.calls.logOutcome
        .mutate({ callId: call.callId, outcome, notes: call.notes.trim() })
        .catch((e: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error("calls.logOutcome failed", e);
          }
        });
    }
    clearCall();
  }

  if (call.phase === "failed") {
    return (
      <div id="callbar" className="on">
        <div className="cbar">
          <div>
            <div className="cb-who">{lead.name}</div>
            {/* Name the actual problem and the next step — never a silent no-op. */}
            <div className="cb-num">Not connected — {call.error ?? "the call could not be placed"}</div>
          </div>
          <button className="cb-end" onClick={clearCall}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (call.phase === "ended") {
    return (
      <div id="callbar" className="on">
        <div className="cbar">
          <div className="cb-who">How did it go?</div>
          {CALL_OUTCOMES.map((o) => (
            <button key={o} className="chip" onClick={() => finish(o)}>
              {o}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const connecting = call.phase === "connecting";
  return (
    <div id="callbar" className="on">
      <div className="cbar">
        <div>
          <div className="cb-who">{lead.name}</div>
          <div className="cb-num">
            {connecting
              ? // Say what is actually happening: their own phone rings first.
                "Ringing your phone — answer to connect"
              : `${lead.phone} · from your business line`}
          </div>
        </div>
        <div className="cb-timer">{connecting ? "—" : cbFmt(call.sec)}</div>
        <input
          placeholder="Type notes while you talk — they save with the call"
          value={call.notes}
          onChange={(e) => setCallNotes(e.target.value)}
        />
        <button className="cb-end" onClick={markCallEnded}>
          End call
        </button>
      </div>
    </div>
  );
}
