/**
 * components/modals/call-modal.tsx
 * Faithful port of openCallSheet + logCallForm (prototype 6415-6491).
 * Two paths: "Call from Mallet" (hands off to the global call bar) and
 * "Log a call" (an inline form that records a past call to the timeline).
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
    <div>
      <h2>{lead.name}</h2>
      {phoneOnFile ? (
        <p className="muted" style={{ marginBottom: "var(--space-2xs)" }}>
          {lead.phone}
        </p>
      ) : (
        // No number on file — the modal becomes the add-a-phone prompt (big,
        // legible). Saving persists + starts the call with the fresh number.
        <>
          <PhoneAddInput
            label="No phone number yet"
            sub={`Add ${lead.name.split(" ")[0]}'s mobile and the call starts right away.`}
            cta="Save & call"
            busy={savingPhone}
            busyLabel="Saving the number…"
            onSave={savePhoneAndCall}
            onCancel={close}
          />
          {phoneSaveFailed && (
            <p className="werr" role="alert">
              The number didn&apos;t save, so the call can&apos;t go out. Check your connection and
              press Save &amp; call again.
            </p>
          )}
        </>
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
              <select value={dir} onChange={(e) => setDir(e.target.value)}>
                <option value="out">I called them</option>
                <option value="in">They called me</option>
              </select>
            </Field>
            <Field label="How long" style={{ marginBottom: "0" }}>
              <input
                value={dur}
                onChange={(e) => setDur(e.target.value)}
                placeholder="e.g. 5m — optional"
              />
            </Field>
            <Field label="When" style={{ marginBottom: "0" }}>
              <select value={when} onChange={(e) => setWhen(e.target.value)}>
                <option>Just now</option>
                <option>Earlier today</option>
                <option>Yesterday</option>
              </select>
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
    </div>
  );
}
