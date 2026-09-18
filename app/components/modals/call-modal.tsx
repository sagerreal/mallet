/**
 * components/modals/call-modal.tsx
 * Faithful port of openCallSheet + logCallForm (prototype 6415-6491), framed in
 * the sheet grammar: a sticky .sheet-head (customer name · number on file) and a
 * sticky .sheet-foot whose one .sheet-pri is the call itself.
 *
 * Two paths: "Call from Mallet" (hands off to the global call bar) and
 * "Log a call" (an inline form that records a past call to the timeline).
 * The pathpick2 card stays tappable alongside the foot primary on purpose — the
 * card is where the transport explanation lives (rings YOUR phone / through this
 * computer, business-number caller ID), and the foot is where the thumb is.
 *
 * Phoneless state: the head's meta line names it ("No phone number yet") and
 * PhoneAddInput renders the labeled field + the sheet foot ([Cancel][Save & call])
 * — the primitive owns the one foot, so this modal docks none of its own there.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { useAppStore, useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { CALL_OUTCOMES } from "@/lib/store/call-constants";
import { hasPhone, PhoneAddInput } from "@/lib/phone";
import { useMe } from "@/features/identity/hooks";
import { browserCallingSupported } from "@/lib/calls/browser-device";
import { Field, FieldGroup } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";

export function CallModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const leads = useAppStore((s) => s.leads);
  const startCall = useAppStore((s) => s.startCall);
  const updateLead = useAppStore((s) => s.updateLead);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead = leads.find((l) => l.id === leadId);

  // Which way this call gets carried. When this browser can be the phone, it is — that is the
  // whole point, and it needs no callback number because the microphone is the leg. Otherwise
  // Mallet rings YOUR handset first, and cannot do that until it knows which one.
  //
  // Decided on mount so the answer cannot change between the render and the press.
  const [carriedHere] = useState(() => browserCallingSupported());
  const me = useMe();
  // Only the bridge needs a number, so only the bridge is gated on one. Saying so before the press
  // matters because the failure would otherwise land in the global call bar, after this modal has
  // already closed.
  const hasCallbackNumber = carriedHere || Boolean(me.data?.callbackNumber);
  const settingsHref = me.data?.role === "tech" ? "/account" : "/settings";
  const [needsCallbackNumber, setNeedsCallbackNumber] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSaveFailed, setPhoneSaveFailed] = useState(false);

  const [logging, setLogging] = useState(false);
  const [outcome, setOutcome] = useState<string>("Connected");
  const [dir, setDir] = useState("out");
  const [dur, setDur] = useState("");
  const [when, setWhen] = useState("Just now");
  const [notes, setNotes] = useState("");

  if (!lead) return null;

  const phoneOnFile = hasPhone(lead);

  function callFromMallet() {
    // No number to ring back on — expand the reason in flow instead of placing a call that the
    // server would refuse. The control stays tappable; it just tells the truth.
    if (!hasCallbackNumber) {
      setNeedsCallbackNumber(true);
      return;
    }
    // startCall reads the store, which the caller has already updated. It returns false only if
    // the lead is somehow still phoneless — don't close then.
    if (startCall(lead!.id, carriedHere ? "browser" : "phone")) close();
  }

  // Add-a-phone → persist → start the call. The AWAIT is the whole point: the store write is
  // optimistic and its network call is fire-and-forget, but `place` runs on the server and reads
  // the customer from the DATABASE, not this store. Starting the call on the optimistic write
  // therefore raced the save it depends on, and lost — the server found no number and refused
  // with "this customer has no phone number on file" on a number just typed in.
  async function savePhoneAndCall(phone: string) {
    setSavingPhone(true);
    const saved = await updateLead(lead!.id, { phone });
    setSavingPhone(false);
    // Rolled back — the number is not on file, so the call would refuse for the same reason.
    // Say that here rather than let it surface in the call bar after this modal has closed.
    if (!saved) {
      setPhoneSaveFailed(true);
      return;
    }
    callFromMallet();
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
    <>
      <div className="sheet-head">
        <h2>{lead.name}</h2>
        <div className="sheet-meta">
          {/* The meta line is the state: the number on file, or the fact there isn't one. */}
          <span>{phoneOnFile ? lead.phone : "No phone number yet"}</span>
        </div>
      </div>
      {!phoneOnFile && (
        // No number on file — the sheet becomes the add-a-phone ask, in the standard
        // grammar (labeled field + [Cancel][Save & call] foot). Saving persists + starts
        // the call with the fresh number.
        <PhoneAddInput
          label="Mobile number"
          sub="Add it and the call starts right away."
          cta="Save & call"
          busy={savingPhone}
          busyLabel="Saving the number…"
          onSave={savePhoneAndCall}
          onCancel={close}
          saveError={
            phoneSaveFailed
              ? "The number didn't save, so the call can't go out. Check your connection and press Save & call again."
              : null
          }
        />
      )}

      {phoneOnFile && (
        <div className="pathpick2">
          <div className="path" onClick={callFromMallet} role="button">
            <b>Call from Mallet</b>
            <p>
              {carriedHere ? (
                <>
                  Talk right here, through this computer. They see your{" "}
                  <b>business number</b>, not your cell.
                </>
              ) : (
                <>
                  Mallet rings <b>your phone</b> first, then connects them. They see
                  your <b>business number</b>, not your cell.
                </>
              )}
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

      {needsCallbackNumber && (
        <div style={{ marginTop: "var(--space-3)" }}>
          <div style={{ fontSize: "var(--type-md)", fontWeight: 700, color: "var(--ink)" }}>
            Mallet needs a number to ring you on
          </div>
          <p className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>
            Add your mobile under Your account, then press Call again.
          </p>
          <Link
            href={settingsHref}
            className="btn primary"
            style={{ display: "inline-block", marginTop: "var(--space-2)" }}
            onClick={close}
          >
            Add your mobile
          </Link>
        </div>
      )}

      {logging && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: "var(--space-4)", paddingTop: "var(--space-3)" }}>
          <FieldGroup label="How did it go?" groupClassName="chips">
            {CALL_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                className={`chip${outcome === o ? " sel" : ""}`}
                onClick={() => setOutcome(o)}
                aria-pressed={outcome === o}
              >
                {o}
              </button>
            ))}
          </FieldGroup>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-3)" }}>
            <Field label="Direction" style={{ marginBottom: "0" }}>
              <SelectMenu
                value={dir}
                onChange={setDir}
                options={[
                  { value: "out", label: "I called them" },
                  { value: "in", label: "They called me" },
                ]}
              />
            </Field>
            <Field label="How long" style={{ marginBottom: "0" }}>
              <input
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                placeholder="e.g. 5m — optional"
              />
            </Field>
            <Field label="When" style={{ marginBottom: "0" }}>
              <SelectMenu
                value={when}
                onChange={setWhen}
                options={[
                  { value: "Just now", label: "Just now" },
                  { value: "Earlier today", label: "Earlier today" },
                  { value: "Yesterday", label: "Yesterday" },
                ]}
              />
            </Field>
          </div>
          <Field label="Notes" style={{ marginTop: "var(--space-3)" }}>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="what they said, what happens next…"
            />
          </Field>
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

      {/* THE primary — the call itself, docked where a one-handed thumb is. */}
      {phoneOnFile && (
        <div className="sheet-foot">
          <button className="sheet-pri" onClick={callFromMallet}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            Call
          </button>
        </div>
      )}
    </>
  );
}
