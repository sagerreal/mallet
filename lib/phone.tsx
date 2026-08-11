/**
 * lib/phone.tsx
 * Everything phone-gating, in ONE module (this replaced the old lib/phone.ts so
 * there is no .ts/.tsx specifier collision under moduleResolution: bundler).
 *
 * Pure helpers (importable by non-React code + tests):
 *   - hasPhone — the ONE has-a-phone check (null/blank/"—" placeholder = no phone).
 *   - ADD_PHONE_TITLE — kept only as the fallback title on read-only field cases.
 *   - phoneFieldError — client-side mirror of the server's Phone.parse rule, for
 *     creation forms (new-job, new-customer) that must not round-trip an invalid
 *     number just to learn it's invalid.
 *
 * JSX pieces:
 *   - PhoneAddInput — the shared in-flow "add a phone number" row (label + tel
 *     input + Save), styled to match the estimate-modal send panel.
 *   - PhoneGate — wraps a Call/Text/Send trigger. The trigger stays TAPPABLE.
 *     On tap: if the record already has a phone, run the action; otherwise expand
 *     an in-flow row beneath the trigger (anchored, flush — no floating UI) to add
 *     one, then AUTO-PROCEED with the fresh number passed explicitly (never race
 *     the optimistic store write).
 *
 * Owen's rules honored: no dead buttons (the trigger always responds), no silent
 * failures (save validates + surfaces inline errors), no standing muted hint line
 * (the add-phone row appears only on tap), no floating UI (it expands in-flow).
 */

"use client";

import { useState, type ReactNode } from "react";
import { Phone } from "@mallet/shared/types";

const NO_PHONE_PLACEHOLDER = "—";

/** Fallback title for a read-only phone-dependent control (field surfaces). */
export const ADD_PHONE_TITLE = "Add a phone number first";

interface PhoneBearer {
  phone?: string | null;
}

/**
 * True when the lead (or any record with a `phone` field) has a real phone
 * number on file — not null/undefined, not blank, not the "—" placeholder.
 */
export function hasPhone(bearer: PhoneBearer | null | undefined): boolean {
  const p = (bearer?.phone ?? "").trim();
  return p.length > 0 && p !== NO_PHONE_PLACEHOLDER;
}

/** The message shown next to a phone field that failed {@link phoneFieldError}. */
export const PHONE_INVALID_MESSAGE = "That phone number isn't valid — use a 10-digit US number.";

/**
 * Validates a raw, user-typed phone number the same way the server does
 * (`Phone.parse` — 10 US digits, an optional leading "1"). The phone field is
 * OPTIONAL on every creation form that calls this, so a blank value is valid —
 * only a NON-EMPTY value that fails the server's rule is an error. Returns the
 * error message to show, or null when the value is fine to submit.
 */
export function phoneFieldError(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return Phone.parse(trimmed).ok ? null : PHONE_INVALID_MESSAGE;
}

/**
 * A stored E.164 number as a person reads it: "+16693413343" → "(669) 341-3343". Anything that
 * isn't a US 11-digit E.164 value is returned unchanged — a settings row that showed a mangled
 * number would be worse than one that showed the raw string.
 */
export function formatPhone(e164: string | null | undefined): string {
  const raw = (e164 ?? "").trim();
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw);
  if (!us) return raw;
  return `(${us[1]}) ${us[2]}-${us[3]}`;
}

interface PhoneAddInputProps {
  /** The field label, e.g. "Mobile number". */
  label: string;
  /** One plain sentence naming what saving does, e.g. "Add it and the call starts right away." */
  sub?: string;
  /** Foot primary copy — says what happens next: "Save & call" / "Save & text". */
  cta?: string;
  /** Called with the validated raw number when the user saves. */
  onSave: (phone: string) => void;
  /** Called to dismiss without saving. */
  onCancel: () => void;
  /**
   * The save is in flight. Blocks a second press: `onSave` may need to wait for the write to be
   * durable before it acts, and a re-press in that window starts a second one.
   */
  busy?: boolean;
  /** Replaces the button copy while `busy`, e.g. "Saving…". */
  busyLabel?: string;
  /** A failure from the CALLER's save (e.g. the write rolled back) — named in the same slot. */
  saveError?: string | null;
}

/**
 * The add-a-phone ask, in the SHEET GRAMMAR — its only two homes are the call and thread
 * modals, and it used to bring its own register instead: a second XL heading fighting the
 * sheet's h2, a full-width primary loose in the body, and a centered link for Cancel
 * (Owen: "properly formatted"). Now it is a plain labeled field with the standard sticky
 * foot — Cancel quiet at its intrinsic width, the one primary taking the rest. The state
 * headline ("No phone number yet") belongs to the caller's sheet-meta line, not here.
 *
 * Still deliberately BIG where it counts — the ICP is a 55-year-old plumber in sunlight:
 * a 17px tel input and a 44px foot.
 */
export function PhoneAddInput({
  label,
  sub,
  cta = "Save",
  onSave,
  onCancel,
  busy = false,
  busyLabel = "Saving\u2026",
  saveError = null,
}: PhoneAddInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (busy) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a mobile number.");
      return;
    }
    // Validate through the same value object the send endpoints use.
    const parsed = Phone.parse(trimmed);
    if (!parsed.ok) {
      setError("That number doesn't look right \u2014 10 digits, US.");
      return;
    }
    setError(null);
    // Persist the raw number the user typed (the store keeps a display value; the
    // send endpoints re-parse). Passing it forward explicitly lets the caller
    // proceed with the fresh value instead of racing the optimistic store update.
    onSave(trimmed);
  }

  const shownError = error ?? saveError;

  return (
    <>
      <div className="field">
        <label htmlFor="phone-add-input">{label}</label>
        <input
          id="phone-add-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value}
          autoFocus
          placeholder="(925) 555-0123"
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onCancel();
          }}
        />
        {sub && (
          <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>
            {sub}
          </div>
        )}
      </div>
      {shownError && (
        <p className="werr" role="alert" style={{ marginTop: "var(--space-2)" }}>
          {shownError}
        </p>
      )}

      {/* The canonical two-button sheet foot: Cancel keeps its intrinsic width, the one
          primary takes the remaining space (the .sheet-pri class is width:100% for a foot
          it has to itself; flex:1/width:auto gives it its share beside Cancel). */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button
          type="button"
          className="btn ghost"
          style={{ flexShrink: 0, minHeight: 44 }}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="sheet-pri"
          style={{ flex: 1, width: "auto", minHeight: 44 }}
          onClick={save}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? busyLabel : cta}
        </button>
      </div>
    </>
  );
}

interface PhoneGateProps {
  /** The record whose phone gates the action (a lead, or any { phone } bearer). */
  bearer: { phone?: string | null } | null | undefined;
  /**
   * Runs the gated action. When the user just added a number, `phone` carries the
   * FRESH value (already validated) — pass it straight to the send/call so the
   * action never reads a stale store value. When a phone was already on file,
   * `phone` is that on-file value.
   */
  onAction: (phone: string) => void;
  /**
   * Persists a freshly-added number (office surfaces pass
   * `(p) => updateLead(lead.id, { phone: p })`). Only called on the add path.
   */
  /**
   * Persist the number. May return the write's outcome; when it reports failure the gate STAYS
   * OPEN and the action does not fire — the number is still on screen to correct.
   */
  onSavePhone?: (phone: string) => void | Promise<{ ok: boolean } | void>;
  /** The prompt heading, e.g. "No phone number yet". */
  addLabel: string;
  /** One-sentence sub under the heading. */
  addSub?: string;
  /** Button copy naming the next action, e.g. "Save & send". */
  addCta?: string;
  /**
   * false on field surfaces that have no lead in the store to write to: the gate
   * renders a read-only "no number" note instead of an add row (see below).
   */
  canAddPhone?: boolean;
  /** The trigger — a render prop given an onClick to wire onto the button. */
  children: (args: { onClick: () => void }) => ReactNode;
}

/**
 * Wrap a Call/Text/Send trigger so it stays tappable and prompts to add a number
 * in-flow when none is on file. See the file header for the full contract.
 */
export function PhoneGate({
  bearer,
  onAction,
  onSavePhone,
  addLabel,
  addSub,
  addCta,
  canAddPhone = true,
  children,
}: PhoneGateProps) {
  const [adding, setAdding] = useState(false);
  const has = hasPhone(bearer);
  const onFile = (bearer?.phone ?? "").trim();

  function handleTrigger() {
    if (has) {
      onAction(onFile);
      return;
    }
    // No phone. A field surface with no lead in the store can't add one — show a
    // read-only note (rendered below) rather than a dead-end add row.
    if (!canAddPhone) {
      setAdding((v) => !v);
      return;
    }
    setAdding(true);
  }

  async function handleSave(phone: string) {
    // AWAITED. This used to fire the save and send in the same breath, so a number the server
    // refused (already on another customer) still sent the message and closed the card — the
    // error arrived afterwards, with nothing left on screen to fix. A rejected number now keeps
    // the row open with the digits still in it.
    const result = await onSavePhone?.(phone);
    if (result && result.ok === false) return;
    setAdding(false);
    // Auto-proceed with the FRESH number — never re-read the store (the optimistic
    // updateLead may not have landed / could be racing a hydrator).
    onAction(phone);
  }

  return (
    <>
      {children({ onClick: handleTrigger })}
      {adding && !has && canAddPhone && onSavePhone && (
        <PhoneAddInput
          label={addLabel}
          sub={addSub}
          cta={addCta}
          onSave={handleSave}
          onCancel={() => setAdding(false)}
        />
      )}
      {adding && !has && !canAddPhone && (
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          No number on file — ask the office to add one.
        </div>
      )}
    </>
  );
}
