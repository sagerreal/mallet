/**
 * app/(public)/q/[token]/QuoteActions.tsx
 *
 * Client-component island for the approve / decline / request-change interaction
 * on the public customer quote page.
 *
 * Design rules:
 *   - Anchored, not floating. Actions expand in-flow, no popovers.
 *   - No login required — the token IS the credential.
 *   - Reduced-motion safe: no CSS animation that would disturb a vestibular user.
 */

"use client";

import { useState } from "react";
import { fmt$ } from "@/lib/format";
import type { QuoteTier } from "@/modules/quoting/domain/estimate";

/** Interaction phase — owned by QuoteLines so the add-on toggles above the
 *  actions lock while an accept is in flight and stay locked once terminal. */
export type QuotePhase =
  | "idle"
  | "declining"
  | "requesting_change"
  | "busy"
  | "approved"
  | "declined"
  | "change_sent"
  | "error";

const DECLINE_REASONS = ["Price", "Timing", "Going with someone else"] as const;
const MAX_CHANGE_MESSAGE = 2000;

interface QuoteActionsProps {
  readonly token: string;
  readonly totalCents: number;
  /** If the customer already submitted a change request, show the received state immediately. */
  readonly changeAlreadyRequested?: boolean;
  /** Optional add-on line IDs the customer toggled ON — sent with the accept so the
   *  server commits the tuned selection (IDs only; line content stays server-side). */
  readonly selectedLineIds?: readonly string[];
  /** Good/Better/Best: the tier the customer selected — sent with the accept.
   *  Null/absent on single quotes (the server rejects a tier there). */
  readonly chosenTier?: QuoteTier | null;
  /** Controlled phase (lifted into QuoteLines so it can lock the toggles). */
  readonly phase: QuotePhase;
  /** Phase transitions. On a successful accept, committedLineIds carries the
   *  selection that was actually SENT so the totals freeze to the committed amount. */
  readonly onPhaseChange: (next: QuotePhase, committedLineIds?: readonly string[]) => void;
}

export function QuoteActions({
  token,
  totalCents,
  changeAlreadyRequested,
  selectedLineIds,
  chosenTier,
  phase,
  onPhaseChange,
}: QuoteActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [changeMessage, setChangeMessage] = useState("");

  // Show the "request sent" banner when the server says a change was already submitted
  // OR when the customer just submitted one in this session.
  const showChangeBanner = changeAlreadyRequested || phase === "change_sent";

  async function callApi(action: "accept" | "decline" | "request_change", payload?: { reason?: string; message?: string; selectedLineIds?: string[]; chosenTier?: QuoteTier }): Promise<void> {
    onPhaseChange("busy");
    setError(null);
    try {
      const res = await fetch(`/api/public/quote/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const serverError = (data as { error?: string }).error;
        if ((res.status === 400 || res.status === 409) && action === "accept") {
          // 400: the add-on selection or tier choice no longer matches the stored
          // quote (invalid_selection / invalid_tier — the server's copy names the
          // problem). 409: the quote is not in an approvable state (not_ready).
          setError(serverError ?? "This quote was updated — reload the page and try again.");
        } else {
          setError(serverError ?? "Something went wrong. Please try again.");
        }
        onPhaseChange(action === "request_change" ? "requesting_change" : "idle");
        return;
      }
      if (action === "accept") {
        // Freeze the totals to the selection that was actually SENT (captured at
        // click time), not whatever the toggles show when the response lands.
        onPhaseChange("approved", payload?.selectedLineIds ?? []);
      } else if (action === "decline") onPhaseChange("declined");
      else onPhaseChange("change_sent");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      onPhaseChange(action === "request_change" ? "requesting_change" : "idle");
    }
  }

  function handleApprove() {
    void callApi("accept", {
      ...(selectedLineIds && selectedLineIds.length > 0
        ? { selectedLineIds: [...selectedLineIds] }
        : {}),
      ...(chosenTier ? { chosenTier } : {}),
    });
  }
  function handleDecline(reason: string) { void callApi("decline", { reason }); }
  function handleRequestChange() {
    const msg = changeMessage.trim();
    if (!msg) { setError("Enter a message before sending."); return; }
    void callApi("request_change", { message: msg });
  }

  if (phase === "approved") {
    return (
      <div className="deltabanner" style={{ textAlign: "center", marginTop: 8 }}>
        Approved — thank you! We&rsquo;ll be in touch soon.
      </div>
    );
  }

  if (phase === "declined") {
    return (
      <div className="reqcard" style={{ textAlign: "center", marginTop: 8 }}>
        No problem — you passed on this one. Reach out if anything changes.
      </div>
    );
  }

  return (
    <>
      {showChangeBanner && (
        <div className="reqcard" style={{ marginTop: 8, marginBottom: 10 }}>
          Request sent — they&rsquo;ll get back to you.
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--red-bg)",
            border: "1px solid var(--red)",
            borderRadius: 9,
            padding: "8px 12px",
            fontSize: 12.5,
            color: "var(--red)",
            marginBottom: 10,
          }}
        >
          {error}
        </div>
      )}

      {/* Primary approve button */}
      <button
        className="btn primary"
        style={{
          width: "100%",
          padding: 13,
          fontSize: 14.5,
          marginTop: 6,
          opacity: phase === "busy" ? 0.6 : 1,
          cursor: phase === "busy" ? "not-allowed" : "pointer",
        }}
        onClick={handleApprove}
        disabled={phase === "busy"}
        aria-busy={phase === "busy"}
      >
        {phase === "busy" ? "Sending…" : `Approve — ${fmt$(totalCents / 100)}`}
      </button>

      {/* "Request a change" in-flow reveal */}
      {phase === "requesting_change" ? (
        <div style={{ marginTop: 12 }}>
          <textarea
            rows={3}
            maxLength={MAX_CHANGE_MESSAGE}
            value={changeMessage}
            onChange={(e) => {
              setChangeMessage(e.target.value);
              if (error) setError(null);
            }}
            placeholder="What would you like adjusted?"
            aria-label="Change request message"
            style={{
              width: "100%",
              border: "1.5px solid var(--line)",
              borderRadius: "var(--radius-sm, 9px)",
              padding: "8px 11px",
              fontFamily: "inherit",
              fontSize: 13.5,
              background: "var(--card)",
              color: "var(--ink)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <button
              className="btn sm ghost"
              onClick={() => { onPhaseChange("idle"); setError(null); setChangeMessage(""); }}
            >
              Cancel
            </button>
            <button
              className="btn sm primary"
              onClick={handleRequestChange}
            >
              Send request
            </button>
          </div>
        </div>
      ) : (
        /* "Not right now" / "Request a change" row */
        phase === "declining" ? (
          <div
            className="chips"
            style={{ justifyContent: "center", marginTop: 10 }}
            role="group"
            aria-label="Reason for declining"
          >
            {DECLINE_REASONS.map((r) => (
              <button
                key={r}
                className="chip"
                onClick={() => handleDecline(r)}
                disabled={phase !== "declining"}
              >
                {r}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 12 }}>
            <button
              className="linklike"
              style={{ color: "var(--ink-3)", background: "none", border: 0, cursor: "pointer" }}
              onClick={() => onPhaseChange("declining")}
              disabled={phase === "busy"}
            >
              Not right now
            </button>
            <button
              className="btn ghost"
              onClick={() => { onPhaseChange("requesting_change"); setError(null); }}
              disabled={phase === "busy"}
            >
              Request a change
            </button>
          </div>
        )
      )}
    </>
  );
}
