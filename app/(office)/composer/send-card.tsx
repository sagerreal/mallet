"use client";

/**
 * Send section — the last act of the composer. Text/Email channel toggle,
 * per-channel copy, the editable delivery destination (persists contact edits
 * to the customer), the automatic follow-ups toggle, and the action row
 * (Preview · Save draft · Send quote).
 *
 * Actions gate with an inline reason (no silent no-ops): the buttons disable
 * and the reason renders next to them until the quote is sendable. Send takes
 * one extra gate the others don't — a destination for the chosen channel
 * (Preview and Save draft don't deliver, so they stay enabled without one).
 */

import { useState, useEffect } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { Lead } from "@/lib/store/types";
import { realTierCount, type ComposerState } from "./composer-state";

/** Matches the server's intro bound; the counter lives with the send now, where the field is. */
const INTRO_MAX_CHARS = 1200;

// ---- Delivery contact field -------------------------------------------------
// Editable phone/email for the chosen send channel. A customer can be added by
// name alone (quick-add), so the contact the quote sends to may be missing — this
// lets you fill it in right here and persists it to the customer (v1.customers.update).

function DeliveryContactField({
  lead,
  channel,
}: {
  lead: Lead;
  channel: "text" | "email";
}) {
  const updateLead = useAppStore((s) => s.updateLead);

  // Current value on file — treat the "—" phone placeholder as empty.
  const current =
    channel === "text"
      ? lead.phone && lead.phone !== "—"
        ? lead.phone
        : ""
      : (lead.email ?? "");

  const [val, setVal] = useState(current);
  // Re-sync when the customer or channel changes (switch customer / toggle channel).
  useEffect(() => {
    setVal(current);
  }, [lead.id, channel, current]);

  function commit() {
    const trimmed = val.trim();
    if (trimmed === current) return; // no change
    updateLead(lead.id, channel === "text" ? { phone: trimmed } : { email: trimmed });
  }

  const label = channel === "text" ? "Mobile number" : "Email address";
  const placeholder = channel === "text" ? "(925) 555-0123" : "name@email.com";

  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      <label
        style={{ display: "block", fontSize: "var(--type-sm)", fontWeight: 600, color: "var(--ink-2)", marginBottom: "var(--space-1)" }}
      >
        {label}
      </label>
      <input
        type={channel === "text" ? "tel" : "email"}
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        style={{
          width: "100%",
          maxWidth: 280,
          border: "1.5px solid var(--line)",
          borderRadius: "var(--radius-sm, 9px)",
          padding: "var(--space-2) var(--space-3)",
          fontFamily: "inherit",
          fontSize: "var(--type-base)",
          background: "var(--card)",
          color: "var(--ink)",
        }}
        aria-label={label}
      />
    </div>
  );
}

// ---- Send card ----------------------------------------------------------------

export function SendCard({
  lead,
  state,
  onUpdate,
  gateReason,
  deliveryGateReason,
  isSending,
  isSavingDraft,
  sendError,
  onPreview,
  onSaveDraft,
  onSend,
}: {
  lead: Lead | null;
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  /** Blocks ALL actions (customer / lines missing) — null when clear. */
  gateReason: string | null;
  /** Blocks SEND only (no destination for the chosen channel) — null when clear. */
  deliveryGateReason: string | null;
  isSending: boolean;
  /** A Save draft is in flight — it awaits the server before it leaves the page. */
  isSavingDraft: boolean;
  sendError: string | null;
  onPreview: () => void;
  onSaveDraft: () => void;
  onSend: () => void;
}) {
  const gated = gateReason != null;
  const sendGated = gated || deliveryGateReason != null;
  // The reason shown next to the action row — the all-actions gate first,
  // else the send-only destination gate.
  const shownReason = gateReason ?? deliveryGateReason;
  // GBB format sends every tier that HAS lines — the customer picks on their
  // quote page. Empty tiers are dropped from the payload, so the button counts
  // only the real ones ("Send quote — 2 options" when one tier is still empty).
  const tierCount = realTierCount(state);

  return (
    <div className="card" style={{ borderColor: "#E6DCC4" }}>
      <h3 style={{ marginTop: "0" }}>
        Send
        {!lead && (
          <span className="muted" style={{ fontWeight: 500, fontSize: "var(--type-sm)", marginLeft: "var(--space-2)" }}>
            add a customer above
          </span>
        )}
      </h3>

      {/* The note that rides with the link — the mock's first element. This IS the intro
          (state.intro); it lived in a separate Message accordion, which meant the words a
          customer reads first were composed a card away from the button that sends them. */}
      <textarea
        rows={2}
        maxLength={INTRO_MAX_CHARS}
        placeholder="A short note that rides with the link…"
        aria-label="A short note that rides with the link"
        value={state.intro}
        onChange={(e) => onUpdate({ intro: e.target.value.slice(0, INTRO_MAX_CHARS) })}
        style={{ width: "100%", marginBottom: "var(--space-3)", resize: "vertical" }}
      />

      {/* Text / email channel toggle */}
      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <button
          type="button"
          className={`btn sm${state.sendChannel === "text" ? " primary" : " ghost"}`}
          onClick={() => onUpdate({ sendChannel: "text" })}
          aria-pressed={state.sendChannel === "text"}
        >
          Text
        </button>
        <button
          type="button"
          className={`btn sm${state.sendChannel === "email" ? " primary" : " ghost"}`}
          onClick={() => onUpdate({ sendChannel: "email" })}
          aria-pressed={state.sendChannel === "email"}
        >
          Email
        </button>
      </div>

      {/* The destination for the chosen channel. No "Send by text / they tap the link"
          narration — the toggle names the channel, and Owen has cut this class of explainer
          from the composer four times. Editable; persists to the customer.
          (SMS needs a provisioned Twilio number, email needs RESEND_API_KEY + EMAIL_FROM —
          both gates are server-enforced and surface through deliveryGateReason/sendError.)
          The automatic-follow-ups toggle is gone on Owen's instruction ("get rid of this
          automatic follow up"); state.fuOn keeps its default and the board still manages
          follow-ups per quote. */}
      {lead && <DeliveryContactField lead={lead} channel={state.sendChannel === "text" ? "text" : "email"} />}

      {/* Send error — shown inline above the buttons */}
      {sendError && (
        <div
          role="alert"
          style={{
            background: "var(--amber-bg)",
            border: "1px solid var(--amber)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
            fontSize: "var(--type-base)",
            color: "var(--amber)",
            marginTop: "var(--space-3)",
          }}
        >
          {sendError}
        </div>
      )}

      {/* Action row — disabled with the reason shown, never a silent no-op.
          "composer-actions" is a mobile-only styling hook (app/prototype.css,
          the COMPOSER MOBILE block) — it changes nothing at desktop widths;
          the inline styles below still own the desktop layout byte-for-byte. */}
      <div
        className="composer-actions"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "var(--space-3)",
          marginTop: "var(--space-3)",
        }}
      >
        {shownReason && (
          <span className="muted" style={{ fontSize: "var(--type-base)" }}>
            {shownReason}
          </span>
        )}
        <button className="btn ghost" onClick={onPreview} disabled={gated || isSavingDraft}>
          Preview
        </button>
        {/* Save draft holds the page until the server has the record, so it reports its own
            in-flight state rather than borrowing the Send button's. */}
        <button
          className="btn ghost"
          onClick={onSaveDraft}
          disabled={gated || isSending || isSavingDraft}
          aria-busy={isSavingDraft}
        >
          {isSavingDraft ? "Saving…" : "Save draft"}
        </button>
      </div>

      {/* The mock's dominant CTA: full width, dark, the last thing on the page. Preview and
          Save draft stay in the small row above — the mock keeps them out of the card entirely
          (they ride the masthead), but Save draft has no masthead seat, so the row holds both. */}
      <button
        className="btn primary"
        onClick={onSend}
        disabled={sendGated || isSending || isSavingDraft}
        aria-busy={isSending}
        style={{
          width: "100%",
          marginTop: "var(--space-3)",
          background: "var(--pri-bg)",
          color: "var(--pri-fg)",
          borderColor: "var(--pri-bg)",
          opacity: sendGated || isSending || isSavingDraft ? 0.6 : 1,
          cursor: sendGated || isSending || isSavingDraft ? "not-allowed" : "pointer",
        }}
      >
        {isSending
          ? "Sending…"
          : tierCount >= 2
            ? `Send estimate — ${tierCount} options`
            : "Send estimate"}
      </button>
    </div>
  );
}
