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
  /** Big heading, e.g. "No phone number for Dana yet". */
  label: string;
  /** One plain sentence under the heading, e.g. "Add their mobile to call them." */
  sub?: string;
  /** Button copy — says what happens next: "Save & call" / "Save & text". */
  cta?: string;
  /** Called with the validated raw number when the user saves. */
  onSave: (phone: string) => void;
  /** Called to dismiss without saving. */
  onCancel: () => void;
}

/**
 * The add-a-phone prompt — deliberately BIG. The ICP is a 55-year-old plumber
 * in sunlight: 19px heading, 17px tel input, one full-width primary button that
 * names the next action. Renders inside the call/thread modals (the "popup"
 * Owen asked for) and in-flow on the OK-queue cards.
 */
export function PhoneAddInput({ label, sub, cta = "Save", onSave, onCancel }: PhoneAddInputProps) {
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
    <div style={{ marginTop: "var(--space-3)", maxWidth: 440 }}>
      <div style={{ fontSize: "var(--type-xl)", fontWeight: 800, color: "var(--ink)", lineHeight: 1.25 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: "var(--type-md)", color: "var(--ink-2)", marginTop: "var(--space-1)" }}>{sub}</div>
      )}
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
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          marginTop: "var(--space-3)",
          border: `2px solid ${error ? "var(--red)" : "var(--line)"}`,
          borderRadius: "var(--radius)",
          padding: "var(--space-3) var(--space-4)",
          fontFamily: "inherit",
          fontSize: "var(--type-lg)",
          background: "var(--card)",
          color: "var(--ink)",
        }}
      />
      {error && (
        <div style={{ marginTop: "var(--space-2)", fontSize: "var(--type-md)", color: "var(--red)" }}>{error}</div>
      )}
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%", marginTop: "var(--space-3)", padding: "var(--space-3) var(--space-4)", fontSize: "var(--type-md)" }}
        onClick={save}
      >
        {cta}
      </button>
      <button
        type="button"
        className="linklike"
        style={{ display: "block", margin: "10px auto 0", fontSize: "var(--type-md)", color: "var(--ink-2)" }}
        onClick={onCancel}
      >
        Cancel
      </button>
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
