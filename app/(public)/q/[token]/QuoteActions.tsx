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
import { authorizationText } from "@/modules/quoting/domain/authorization-text";
import { SignaturePad } from "@/components/shared/signature-pad";

/** Interaction phase — owned by QuoteLines so the add-on toggles above the
 *  actions lock while an accept is in flight and stay locked once terminal. */
export type QuotePhase =
  | "idle"
  | "signing"
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
  /** The shop's name and the deposit, so the page renders the SAME sentence the server stores.
   *  Both sides call one function (authorizationText), so what is displayed and what is recorded
   *  cannot drift into being different sentences. The server renders its own copy from stored
   *  data — this one is display only and is never sent. */
  readonly orgName: string;
  readonly depositCents: number;
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
  orgName,
  depositCents,
  changeAlreadyRequested,
  selectedLineIds,
  chosenTier,
  phase,
  onPhaseChange,
}: QuoteActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [changeMessage, setChangeMessage] = useState("");
  const [signerName, setSignerName] = useState("");
  const [signatureSvg, setSignatureSvg] = useState("");

  // Show the "request sent" banner when the server says a change was already submitted
  // OR when the customer just submitted one in this session.
  const showChangeBanner = changeAlreadyRequested || phase === "change_sent";

  async function callApi(action: "accept" | "decline" | "request_change", payload?: { reason?: string; message?: string; selectedLineIds?: string[]; chosenTier?: QuoteTier; signerName?: string; signatureSvg?: string }): Promise<void> {
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
        // Where a rejected accept lands depends on WHAT was rejected, and getting this wrong
        // traps the customer either way:
        //
        //   the signature  → stay in the panel. Their name and mark are still on screen and
        //                    still fine; sending them back would mean drawing it again to fix
        //                    a typo. The server tags these with a field.
        //   anything else  → back to idle. A rejected tier or add-on selection has to be
        //                    CHANGED to succeed, and the signing panel locks exactly those
        //                    controls — leaving them there is a dead end with no way out.
        const signatureRejected = typeof (data as { field?: unknown }).field === "string";
        onPhaseChange(
          action === "request_change"
            ? "requesting_change"
            : action === "accept" && signatureRejected
              ? "signing"
              : "idle",
        );
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
      onPhaseChange(
        action === "request_change" ? "requesting_change" : action === "accept" ? "signing" : "idle",
      );
    }
  }

  /**
   * Submit the signed approval.
   *
   * Only the NAME is required. The drawing is genuinely optional — see the note in
   * modules/quoting/domain/signature.ts: a typed name is a signature under Texas law, while the
   * drawn mark is the one form the Texas Supreme Court declined to rule on. Requiring it would
   * gate approval on the weakest evidence in the record and lock out anyone without a pointer.
   *
   * Checked here for an instant message; the server checks again, because a client-side check is
   * a courtesy and not a guarantee.
   */
  function handleSign() {
    if (!signerName.trim()) {
      setError("Type your name to sign.");
      return;
    }
    void callApi("accept", {
      ...(selectedLineIds && selectedLineIds.length > 0
        ? { selectedLineIds: [...selectedLineIds] }
        : {}),
      ...(chosenTier ? { chosenTier } : {}),
      signerName: signerName.trim(),
      // Omitted entirely when nothing was drawn — the route's schema rejects an empty string, and
      // "they signed by typing their name" is a different record from "they drew nothing".
      ...(signatureSvg ? { signatureSvg } : {}),
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
      <div className="deltabanner" style={{ textAlign: "center", marginTop: "var(--space-2)" }}>
        Approved — thank you! We&rsquo;ll be in touch soon.
      </div>
    );
  }

  if (phase === "declined") {
    return (
      <div className="reqcard" style={{ textAlign: "center", marginTop: "var(--space-2)" }}>
        No problem — you passed on this one. Reach out if anything changes.
      </div>
    );
  }

  return (
    <>
      {showChangeBanner && (
        <div className="reqcard" style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          Request sent — they&rsquo;ll get back to you.
        </div>
      )}

      {error && (
        <div
          role="alert"
          style={{
            background: "var(--red-bg)",
            border: "1px solid var(--red)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
            fontSize: "var(--type-base)",
            color: "var(--red)",
            marginBottom: "var(--space-3)",
          }}
        >
          {error}
        </div>
      )}

      {/* Primary approve button. Opens the signing panel rather than approving outright —
          the second, deliberate act is the point: a click proves somebody held the link, a
          typed name and a drawn mark say who, and to what. */}
      {phase !== "signing" && phase !== "busy" && (
        <button
          className="btn primary"
          style={{
            width: "100%",
            padding: "var(--space-3)",
            fontSize: "var(--type-md)",
            marginTop: "var(--space-2)",
          }}
          onClick={() => {
            setError(null);
            onPhaseChange("signing");
          }}
        >
          {`Approve — ${fmt$(totalCents / 100)}`}
        </button>
      )}

      {/* Signing panel — in-flow and anchored, never a modal or a popover. */}
      {(phase === "signing" || phase === "busy") && (
        <div
          style={{
            marginTop: "var(--space-3)",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            background: "var(--card)",
          }}
        >
          <p
            style={{
              margin: 0,
              marginBottom: "var(--space-3)",
              fontSize: "var(--type-base)",
              lineHeight: 1.55,
              color: "var(--ink)",
            }}
          >
            {authorizationText({ totalCents, depositCents, orgName })}
          </p>

          <label
            htmlFor="signer-name"
            style={{
              display: "block",
              fontSize: "var(--type-sm)",
              color: "var(--ink-2)",
              marginBottom: "var(--space-1)",
            }}
          >
            Your full name — typing it here is your signature
          </label>
          <input
            id="signer-name"
            type="text"
            value={signerName}
            maxLength={120}
            autoComplete="name"
            disabled={phase === "busy"}
            onChange={(e) => {
              setSignerName(e.target.value);
              if (error) setError(null);
            }}
            style={{
              width: "100%",
              border: "1.5px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-2) var(--space-3)",
              fontFamily: "inherit",
              fontSize: "var(--type-base)",
              background: "var(--bg)",
              color: "var(--ink)",
              boxSizing: "border-box",
              marginBottom: "var(--space-3)",
            }}
          />

          <SignaturePad
            value={signatureSvg}
            disabled={phase === "busy"}
            aria-label="Draw your signature"
            onChange={(svg) => {
              setSignatureSvg(svg);
              if (error) setError(null);
            }}
          />

          <button
            className="btn primary"
            style={{
              width: "100%",
              padding: "var(--space-3)",
              fontSize: "var(--type-md)",
              marginTop: "var(--space-3)",
              opacity: phase === "busy" ? 0.6 : 1,
              cursor: phase === "busy" ? "not-allowed" : "pointer",
            }}
            onClick={handleSign}
            disabled={phase === "busy"}
            aria-busy={phase === "busy"}
          >
            {phase === "busy" ? "Sending…" : `Sign & approve — ${fmt$(totalCents / 100)}`}
          </button>

          {phase !== "busy" && (
            <button
              onClick={() => {
                setError(null);
                onPhaseChange("idle");
              }}
              style={{
                display: "block",
                margin: "var(--space-2) auto 0",
                border: "none",
                background: "none",
                padding: 0,
                fontFamily: "inherit",
                fontSize: "var(--type-sm)",
                color: "var(--ink-2)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              Back
            </button>
          )}
        </div>
      )}

      {/* "Request a change" in-flow reveal */}
      {phase === "requesting_change" ? (
        <div style={{ marginTop: "var(--space-3)" }}>
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
              padding: "var(--space-2) var(--space-3)",
              fontFamily: "inherit",
              fontSize: "var(--type-base)",
              background: "var(--card)",
              color: "var(--ink)",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)", justifyContent: "flex-end" }}>
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
            style={{ justifyContent: "center", marginTop: "var(--space-3)" }}
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
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "var(--space-4)", marginTop: "var(--space-3)" }}>
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
