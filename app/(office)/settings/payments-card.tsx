"use client";

/**
 * Settings → Payments → "Get paid" card. Stripe Connect (Express) onboarding: links the shop's own
 * bank through Stripe's hosted setup so customers can pay by card and payouts land in the shop's
 * account. No money moves here — this only connects the account. Starting onboarding redirects to
 * Stripe; on the return redirect (?tab=payments&connect=return) we refresh status once. States:
 * Not connected → "Get paid"; Setup started → "Finish setup"; Connected ✓ (charges + payouts).
 * In-flow (no floating UI); plain business labels; house .btn classes.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";

export function PaymentsCard() {
  const status = api.v1.settings.payments.status.useQuery();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);

  const begin = api.v1.settings.payments.beginOnboarding.useMutation({
    onError: (e) => setError(e.message || "Couldn't start setup — try again."),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const refresh = api.v1.settings.payments.refresh.useMutation({
    onSuccess: () => utils.v1.settings.payments.status.invalidate(),
    onError: (e) => setError(e.message || "Couldn't refresh status — try again."),
  });

  // On the Stripe onboarding-return redirect, pull the latest status once, then strip the connect
  // param so a manual page refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tab") === "payments" && params.get("connect") === "return") {
      refresh.mutate();
      params.delete("connect");
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
    // Runs once on mount to consume the Stripe onboarding-return redirect; refresh is stable.
  }, []);

  const s = status.data;
  // detailsSubmitted = the shop finished Stripe's hosted form (onboarding complete). charges/payouts
  // may still be "pending" while Stripe verifies. hasAccount without detailsSubmitted = they began
  // but abandoned → offer to resume.
  const complete = !!s?.detailsSubmitted;
  const started = !!s && s.hasAccount && !s.detailsSubmitted;

  return (
    <FoldCard title="Payments" summary={complete ? "Connected" : "Not connected"} defaultOpen>
      <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "0 0 14px" }}>
        Connect your bank through Stripe so customers can pay you by card. Stripe verifies your
        details and deposits payouts to your account.
      </p>

      {status.isLoading ? (
        <p style={{ fontSize: "var(--type-base)", color: "var(--ink-3)" }}>Loading…</p>
      ) : complete ? (
        <div style={{ fontSize: 13.5 }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-1)" }}>Connected ✓</div>
          <div style={{ color: "var(--ink-2)" }}>
            Card charges {s?.chargesEnabled ? "enabled" : "pending"} · Payouts{" "}
            {s?.payoutsEnabled ? "enabled" : "pending"}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {started && (
            <div style={{ fontSize: "var(--type-base)", color: "var(--ink-2)" }}>
              Setup started but not finished — pick up where you left off.
            </div>
          )}
          <div>
            <button
              className="btn primary"
              disabled={begin.isPending}
              onClick={() => {
                setError(null);
                begin.mutate();
              }}
            >
              {begin.isPending ? "Opening Stripe…" : started ? "Finish setup" : "Get paid"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p style={{ color: "var(--red)", fontSize: 12.5, margin: "10px 0 0" }} role="alert">
          {error}
        </p>
      )}
    </FoldCard>
  );
}
