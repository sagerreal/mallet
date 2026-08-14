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
      <h3 style={{ marginTop: "0" }}>Send</h3>

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

      {state.sendChannel === "text" ? (
        <>
          <b style={{ fontSize: "var(--type-base)" }}>Send by text</b>
          <p
            className="muted"
            style={{ fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}
          >
            They tap the link, see it, approve it — no inbox to dig
            through, nothing blocks the send.
          </p>
          {/* Editable — the number the quote texts to (persists to the customer). */}
          {lead && <DeliveryContactField lead={lead} channel="text" />}
          {/* Gating note: SMS delivery requires a provisioned Twilio number (A2P).
              The call is wired; if Twilio isn't configured the server returns
              PRECONDITION_FAILED and the composer shows the error. */}
        </>
      ) : (
        <>
          <b style={{ fontSize: "var(--type-base)" }}>Send by email</b>
          <p
            className="muted"
            style={{ fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}
          >
            They click the link in the email, see the quote, and approve
            right there.
          </p>
          {/* Editable — the address the quote emails to (persists to the customer). */}
          {lead && <DeliveryContactField lead={lead} channel="email" />}
          {/* Gating note: email delivery requires RESEND_API_KEY + EMAIL_FROM.
              Gating is enforced server-side; the call is wired. */}
        </>
      )}

      {/* Follow-up toggle */}
      <div className="fu-toggle">
        <div
          className={`switch${state.fuOn ? "" : " off"}`}
          onClick={() => onUpdate({ fuOn: !state.fuOn })}
        />
        <div>
          <b>
            Automatic follow-ups: {state.fuOn ? "on" : "off"}
          </b>{" "}
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            {state.fuOn
              ? "— 2 reminders, then it flags you to call"
              : "— you'll remind them yourself"}
          </span>
        </div>
      </div>

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
        <button
          className="btn primary"
          onClick={onSend}
          disabled={sendGated || isSending || isSavingDraft}
          aria-busy={isSending}
          style={{
            opacity: sendGated || isSending || isSavingDraft ? 0.6 : 1,
            cursor: sendGated || isSending || isSavingDraft ? "not-allowed" : "pointer",
          }}
        >
          {isSending
            ? "Sending…"
            : tierCount >= 2
              ? `Send quote — ${tierCount} options`
              : "Send quote"}
        </button>
      </div>
    </div>
  );
}
