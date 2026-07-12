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
import { recommendedTier, type ComposerState } from "./composer-state";

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
    <div style={{ marginTop: 10 }}>
      <label
        style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 3 }}
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
          padding: "8px 11px",
          fontFamily: "inherit",
          fontSize: 13.5,
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
  // GBB format sends all three options — the customer picks on their quote page.
  const isGbb = recommendedTier(state) != null;

  return (
    <div className="card" style={{ borderColor: "#E6DCC4" }}>
      <h3 style={{ marginTop: 0 }}>Send</h3>

      {/* Text / email channel toggle */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
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
          <b style={{ fontSize: 13 }}>Send by text</b>
          <p
            className="muted"
            style={{ fontSize: 12, margin: "3px 0 0" }}
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
          <b style={{ fontSize: 13 }}>Send by email</b>
          <p
            className="muted"
            style={{ fontSize: 12, margin: "3px 0 0" }}
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
          <span className="muted" style={{ fontSize: 12 }}>
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
            borderRadius: 9,
            padding: "8px 12px",
            fontSize: 12.5,
            color: "var(--amber)",
            marginTop: 12,
          }}
        >
          {sendError}
        </div>
      )}

      {/* Action row — disabled with the reason shown, never a silent no-op */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
          marginTop: 12,
        }}
      >
        {shownReason && (
          <span className="muted" style={{ fontSize: 12.5 }}>
            {shownReason}
          </span>
        )}
        <button className="btn ghost" onClick={onPreview} disabled={gated}>
          Preview
        </button>
        <button
          className="btn ghost"
          onClick={onSaveDraft}
          disabled={gated || isSending}
        >
          Save draft
        </button>
        <button
          className="btn primary"
          onClick={onSend}
          disabled={sendGated || isSending}
          aria-busy={isSending}
          style={{
            opacity: sendGated || isSending ? 0.6 : 1,
            cursor: sendGated || isSending ? "not-allowed" : "pointer",
          }}
        >
          {isSending
            ? "Sending…"
            : isGbb
              ? "Send quote — 3 options"
              : "Send quote"}
        </button>
      </div>
    </div>
  );
}
