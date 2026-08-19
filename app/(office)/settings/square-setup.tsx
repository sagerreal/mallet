"use client";

/**
 * Settings → Payments → Square.
 *
 * WHY SQUARE AT ALL: a shop already running Square will not change processors to change software.
 * The reader is on their counter and their money already lands in that account. Connecting here
 * does NOT move their money anywhere new — payments Mallet takes arrive in the same Square account,
 * on the same payout schedule, in the same dashboard they already check. That is the whole reason
 * this is worth building, so the copy says it rather than assuming they know.
 *
 * Three states, and each says what to do next:
 *   server not configured  → nothing to click; say so rather than offering a dead button
 *   not connected          → Connect
 *   connected              → which merchant, and how to disconnect
 *
 * List-first rows, in-flow, tokens only.
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";

const label = { fontSize: "var(--type-base)", color: "var(--ink-2)" } as const;
const note = { fontSize: "var(--type-sm)", color: "var(--ink-3)" } as const;

export function SquareSetup() {
  const status = api.v1.payments.square.status.useQuery();
  const provider = api.v1.payments.provider.get.useQuery();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const connect = api.v1.payments.square.connectUrl.useMutation({
    // A full navigation, not a popup: Square's consent screen is a login, and logins in popups get
    // blocked or lose the session.
    onSuccess: (d) => {
      window.location.href = d.url;
    },
    onError: (e) => setError(e.message),
  });

  const setProvider = api.v1.payments.provider.set.useMutation({
    onSuccess: () => {
      void utils.v1.payments.provider.get.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  const disconnect = api.v1.payments.square.disconnect.useMutation({
    onSuccess: () => {
      setArmed(false);
      void utils.v1.payments.square.status.invalidate();
    },
    onError: (e) => setError(e.message),
  });

  if (status.isLoading) {
    return (
      <p style={{ ...label, color: "var(--ink-3)" }} aria-busy="true">
        Loading…
      </p>
    );
  }
  if (status.error || !status.data) {
    return (
      <p style={{ ...label, color: "var(--red)" }} role="alert">
        Couldn’t read your Square connection. {status.error?.message ?? ""}
      </p>
    );
  }

  const s = status.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {!s.configured && (
        <p style={note}>Square isn’t set up on this server yet.</p>
      )}

      {s.configured && !s.connected && (
        <>
          <p style={note}>
            Take card payments through the Square account you already use. Money lands where it
            lands today — same payouts, same dashboard.
          </p>
          <button
            type="button"
            className="btn"
            style={{ alignSelf: "flex-start" }}
            aria-disabled={connect.isPending ? true : undefined}
            onClick={(e) => {
              if (connect.isPending) {
                e.preventDefault();
                return;
              }
              setError(null);
              connect.mutate();
            }}
          >
            {connect.isPending ? "Opening Square…" : "Connect Square"}
          </button>
        </>
      )}

      {s.connected && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
            <span style={label}>Connected</span>
            {s.merchantId && <span style={note}>merchant {s.merchantId}</span>}
          </div>

          {/* WHICH PROCESSOR INVOICES GO THROUGH. Connecting Square does not switch anything by
              itself — a shop mid-migration needs both connected while they decide, and flipping
              their live invoicing as a side effect of connecting would be the wrong default. */}
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <span style={note}>Take card payments through</span>
            <div className="seg" role="group" aria-label="Card processor">
              {(["stripe", "square"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={provider.data?.provider === p}
                  aria-disabled={setProvider.isPending ? true : undefined}
                  onClick={(e) => {
                    if (setProvider.isPending) {
                      e.preventDefault();
                      return;
                    }
                    setError(null);
                    setProvider.mutate({ provider: p });
                  }}
                >
                  {p === "stripe" ? "Stripe" : "Square"}
                </button>
              ))}
            </div>
          </div>
          {/* Two-tap, the sweep-modal pattern: disconnecting stops card payments, so it must not
              be one stray tap away. */}
          <button
            type="button"
            className="btn sm"
            style={{ alignSelf: "flex-start" }}
            aria-disabled={disconnect.isPending ? true : undefined}
            onClick={(e) => {
              if (disconnect.isPending) {
                e.preventDefault();
                return;
              }
              setError(null);
              if (!armed) {
                setArmed(true);
                return;
              }
              disconnect.mutate();
            }}
          >
            {disconnect.isPending
              ? "Disconnecting…"
              : armed
                ? "Really disconnect? Tap again"
                : "Disconnect"}
          </button>
        </>
      )}

      {error && (
        <p style={{ ...note, color: "var(--red)" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
