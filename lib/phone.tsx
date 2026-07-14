/**
 * lib/phone.tsx
 * Everything phone-gating, in ONE module (this replaced the old lib/phone.ts so
 * there is no .ts/.tsx specifier collision under moduleResolution: bundler).
 *
 * Pure helpers (importable by non-React code + tests):
 *   - hasPhone — the ONE has-a-phone check (null/blank/"—" placeholder = no phone).
 *   - ADD_PHONE_TITLE — kept only as the fallback title on read-only field cases.
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

interface PhoneAddInputProps {
  /** Label above the input, e.g. "Add a phone number to call them". */
  label: string;
  /** Called with the validated raw number when the user saves. */
  onSave: (phone: string) => void;
  /** Called to dismiss the row without saving. */
  onCancel: () => void;
}

/**
 * Shared in-flow add-a-phone row: a bold 11.5px label, a bordered tel input
 * (maxWidth 280), a primary Save, and inline red validation errors. Mirrors the
 * estimate-modal send panel's destination input so every phone-add surface reads
 * the same.
 */
export function PhoneAddInput({ label, onSave, onCancel }: PhoneAddInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a mobile number.");
      return;
    }
    // Validate through the same value object the send endpoints use.
    const parsed = Phone.parse(trimmed);
    if (!parsed.ok) {
      setError("That number doesn't look right — 10 digits, US.");
      return;
    }
    setError(null);
    // Persist the raw number the user typed (the store keeps a display value; the
    // send endpoints re-parse). Passing it forward explicitly lets the caller
    // proceed with the fresh value instead of racing the optimistic store update.
    onSave(trimmed);
  }

  return (
    <div style={{ marginTop: 8 }}>
      <label
        style={{
          display: "block",
          fontSize: 11.5,
          fontWeight: 700,
          color: "var(--ink-2)",
          marginBottom: 3,
        }}
      >
        {label}
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <input
          type="tel"
          value={value}
          autoFocus
          placeholder="(925) 555-0123"
          aria-label={label}
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
          style={{
            flex: "1 1 auto",
            width: "100%",
            maxWidth: 280,
            border: `1.5px solid ${error ? "var(--red)" : "var(--line)"}`,
            borderRadius: "var(--radius-sm, 9px)",
            padding: "8px 11px",
            fontFamily: "inherit",
            fontSize: 13.5,
            background: "var(--card)",
            color: "var(--ink)",
          }}
        />
        <button type="button" className="btn primary sm" onClick={save}>
          Save
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 4, fontSize: 12, color: "var(--red)" }}>{error}</div>
      )}
    </div>
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
  onSavePhone?: (phone: string) => void;
  /** The add-phone row label, e.g. "Add a phone number to call them". */
  addLabel: string;
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

  function handleSave(phone: string) {
    onSavePhone?.(phone);
    setAdding(false);
    // Auto-proceed with the FRESH number — never re-read the store (the optimistic
    // updateLead may not have landed / could be racing a hydrator).
    onAction(phone);
  }

  return (
    <>
      {children({ onClick: handleTrigger })}
      {adding && !has && canAddPhone && onSavePhone && (
        <PhoneAddInput label={addLabel} onSave={handleSave} onCancel={() => setAdding(false)} />
      )}
      {adding && !has && !canAddPhone && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          No number on file — ask the office to add one.
        </div>
      )}
    </>
  );
}
