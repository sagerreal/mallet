/**
 * components/shell/call-bar.tsx
 * Global live-call bar (prototype renderCallBar/endCall/finishCall, 6437-6466).
 * Mounted once app-wide; persists after the Call modal closes. Live phase runs a
 * 1s timer + notes field; ended phase shows the outcome chips that log the call.
 */

"use client";

import { useEffect } from "react";
import { useAppStore, useActiveCall } from "@/lib/store/app-store";
import { CALL_OUTCOMES } from "@/lib/store/call-constants";

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
    addLeadNote(call.leadId, {
      type: "call",
      dir: "out",
      outcome,
      dur: cbFmt(call.sec),
      via: "elas",
      when: "Just now",
      notes: call.notes.trim(),
    });
    clearCall();
  }

  return (
    <div id="callbar" className="on">
      {call.phase === "live" ? (
        <div className="cbar">
          <div>
            <div className="cb-who">{lead.name}</div>
            <div className="cb-num">{lead.phone} · from your business line</div>
          </div>
          <div className="cb-timer">{cbFmt(call.sec)}</div>
          <input
            placeholder="Type notes while you talk — they save with the call"
            value={call.notes}
            onChange={(e) => setCallNotes(e.target.value)}
          />
          <button className="cb-end" onClick={markCallEnded}>
            End call
          </button>
        </div>
      ) : (
        <div className="cbar">
          <div className="cb-who">How did it go?</div>
          {CALL_OUTCOMES.map((o) => (
            <button key={o} className="chip" onClick={() => finish(o)}>
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
