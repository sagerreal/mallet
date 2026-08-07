/**
 * components/modals/tech-job-modal/follow-up-ask.tsx
 * "Need to come back" — booking the return trip from the customer's doorstep.
 *
 * A REASON, NOT A DATE, and that is the whole design. The technician records that a return is
 * needed and why; the office picks the slot. When the part lands, who else is out, whose week has
 * room — none of that is visible from a doorstep, and letting him commit the shop to a day he
 * cannot verify is how a customer gets stood up.
 *
 * So the confirmation says what he can honestly repeat to the customer standing next to him: the
 * office will call to set a time. Never a fabricated date.
 *
 * Expands IN FLOW under its own button — house rule, no popovers, no sheet on top of a sheet.
 */

"use client";

import { useState } from "react";
import { AO_INPUT } from "./helpers";

interface FollowUpAskProps {
  /** Books the visit. Resolves `{ok:false, error}` rather than throwing — the field is offline a lot. */
  onBook: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}

export function FollowUpAsk({ onBook }: FollowUpAskProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const book = async () => {
    if (!reason.trim() || saving) return;
    setSaving(true);
    setError("");
    const result = await onBook(reason);
    setSaving(false);
    if (!result.ok) {
      setError(result.error ?? "Couldn't book the return trip. Try again.");
      return;
    }
    setReason("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn sm ghost"
        style={{ width: "100%", marginTop: "var(--space-2)" }}
        onClick={() => setOpen(true)}
      >
        Need to come back — add a visit
      </button>
    );
  }

  return (
    <div style={{ marginTop: "var(--space-2)" }}>
      <textarea
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          if (error) setError("");
        }}
        rows={3}
        maxLength={2000}
        autoFocus
        disabled={saving}
        aria-label="Why you need to come back"
        placeholder="Why you need to come back — waiting on a part, needs a second pair of hands."
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", ...AO_INPUT }}
      />
      {/* Said BEFORE he taps, so he can tell the customer the true thing while they are still
          standing there. A promise of a day this screen cannot keep is worse than no day. */}
      <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>
        The office will call the customer to set a time.
      </div>
      {error ? (
        <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
        <button
          type="button"
          className="btn sm primary"
          disabled={saving || !reason.trim()}
          onClick={() => void book()}
        >
          {saving ? "Booking…" : "Add the visit"}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setError("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
