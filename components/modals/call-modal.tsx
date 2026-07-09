/**
 * components/modals/call-modal.tsx
 * Faithful port of openCallSheet + logCallForm (prototype 6415-6491).
 * Two paths: "Call from Mallet" (hands off to the global call bar) and
 * "Log a call" (an inline form that records a past call to the timeline).
 */

"use client";

import { useState } from "react";
import { useAppStore, useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { CALL_OUTCOMES } from "@/lib/store/call-constants";

export function CallModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const leads = useAppStore((s) => s.leads);
  const startCall = useAppStore((s) => s.startCall);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead = leads.find((l) => l.id === leadId);

  const [logging, setLogging] = useState(false);
  const [outcome, setOutcome] = useState<string>("Connected");
  const [dir, setDir] = useState("out");
  const [dur, setDur] = useState("");
  const [when, setWhen] = useState("Just now");
  const [notes, setNotes] = useState("");

  if (!lead) return null;

  function callFromMallet() {
    startCall(lead!.id);
    close();
  }

  function saveLogged() {
    addLeadNote(lead!.id, {
      type: "call",
      dir,
      outcome,
      dur: dur.trim(),
      via: "logged",
      when,
      notes: notes.trim(),
    });
    close();
  }

  return (
    <div>
      <h2>{lead.name}</h2>
      <p className="muted" style={{ marginBottom: 2 }}>
        {lead.phone}
      </p>

      <div className="pathpick2">
        <div className="path" onClick={callFromMallet} role="button">
          <b>Call from Mallet</b>
          <p>
            They see your <b>business number</b>, not your cell. The call logs
            itself — type notes while you talk.
          </p>
        </div>
        <div className="path" onClick={() => setLogging(true)} role="button">
          <b>Log a call</b>
          <p>
            Already called from your own phone? Take ten seconds to record what
            happened.
          </p>
        </div>
      </div>

      {logging && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12 }}>
          <div className="field">
            <label>How did it go?</label>
            <div className="chips">
              {CALL_OUTCOMES.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`chip${outcome === o ? " sel" : ""}`}
                  onClick={() => setOutcome(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Direction</label>
              <select value={dir} onChange={(e) => setDir(e.target.value)}>
                <option value="out">I called them</option>
                <option value="in">They called me</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>How long</label>
              <input
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                placeholder="e.g. 5m — optional"
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>When</label>
              <select value={when} onChange={(e) => setWhen(e.target.value)}>
                <option>Just now</option>
                <option>Earlier today</option>
                <option>Yesterday</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="what they said, what happens next…"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn ghost" onClick={close}>
              Cancel
            </button>
            <button className="btn primary" onClick={saveLogged}>
              Save call
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
