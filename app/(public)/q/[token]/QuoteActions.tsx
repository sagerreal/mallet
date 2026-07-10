/**
 * app/(public)/q/[token]/QuoteActions.tsx
 *
 * Client-component island for the approve / decline interaction on the public
 * customer quote page. The server component renders the static quote; this island
 * owns the interactive state (idle → approved | declined).
 *
 * POST /api/public/quote/[token]  { action: "accept" | "decline", reason? }
 *
 * Design rules:
 *   - Anchored, not floating. Actions expand in-flow, no popovers.
 *   - No login required — the token IS the credential.
 *   - Reduced-motion safe: no CSS animation that would disturb a vestibular user.
 */

"use client";

import { useState } from "react";
import { fmt$ } from "@/lib/format";

type Phase = "idle" | "declining" | "busy" | "approved" | "declined" | "error";

const DECLINE_REASONS = ["Price", "Timing", "Going with someone else"] as const;

interface QuoteActionsProps {
  readonly token: string;
  readonly totalCents: number;
}

export function QuoteActions({ token, totalCents }: QuoteActionsProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function callApi(action: "accept" | "decline", reason?: string): Promise<void> {
    setPhase("busy");
    setError(null);
    try {
      const res = await fetch(`/api/public/quote/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? "Something went wrong. Please try again.");
        setPhase("idle");
        return;
      }
      setPhase(action === "accept" ? "approved" : "declined");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setPhase("idle");
    }
  }

  function handleApprove() {
    void callApi("accept");
  }

  function handleDecline(reason: string) {
    void callApi("decline", reason);
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

      {/* "Not right now" → reason chips (in-flow, no popover) */}
      {phase === "declining" ? (
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
        <div style={{ textAlign: "center", marginTop: 10 }}>
          <button
            className="linklike"
            style={{ color: "var(--ink-3)", background: "none", border: 0, cursor: "pointer" }}
            onClick={() => setPhase("declining")}
            disabled={phase === "busy"}
          >
            Not right now
          </button>
        </div>
      )}
    </>
  );
}
