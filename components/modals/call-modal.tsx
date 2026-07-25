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
import { hasPhone, PhoneAddInput } from "@/lib/phone";

export function CallModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const leads = useAppStore((s) => s.leads);
  const startCall = useAppStore((s) => s.startCall);
  const updateLead = useAppStore((s) => s.updateLead);
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

  const phoneOnFile = hasPhone(lead);

  function callFromMallet() {
    // startCall re-reads the store; the optimistic updateLead below runs first
    // and synchronously, so the fresh number is already in place. startCall
    // returns false only if the lead is somehow still phoneless — don't close then.
    if (startCall(lead!.id)) close();
  }

  // Add-a-phone → persist optimistically (synchronous store write) → start the call.
  function savePhoneAndCall(phone: string) {
    updateLead(lead!.id, { phone });
    if (startCall(lead!.id)) close();
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
      {phoneOnFile ? (
        <p className="muted" style={{ marginBottom: "var(--space-2xs)" }}>
          {lead.phone}
        </p>
      ) : (
        // No number on file — the modal becomes the add-a-phone prompt (big,
        // legible). Saving persists + starts the call with the fresh number.
        <PhoneAddInput
          label="No phone number yet"
          sub={`Add ${lead.name.split(" ")[0]}'s mobile and the call starts right away.`}
          cta="Save & call"
          onSave={savePhoneAndCall}
          onCancel={close}
        />
      )}

      {phoneOnFile && (
        <div className="pathpick2">
          <div className="path" onClick={callFromMallet} role="button">
            <b>Call from Mallet</b>
            <p>
              Mallet rings <b>your phone</b> first, then connects them. They see
              your <b>business number</b>, not your cell.
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
      )}

      {logging && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: "var(--space-4)", paddingTop: "var(--space-3)" }}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
            <div className="field" style={{ marginBottom: "0" }}>
              <label>Direction</label>
              <select value={dir} onChange={(e) => setDir(e.target.value)}>
                <option value="out">I called them</option>
                <option value="in">They called me</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: "0" }}>
              <label>How long</label>
              <input
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                placeholder="e.g. 5m — optional"
              />
            </div>
            <div className="field" style={{ marginBottom: "0" }}>
              <label>When</label>
              <select value={when} onChange={(e) => setWhen(e.target.value)}>
                <option>Just now</option>
                <option>Earlier today</option>
                <option>Yesterday</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ marginTop: "var(--space-3)" }}>
            <label>Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="what they said, what happens next…"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
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
