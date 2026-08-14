"use client";

/**
 * Settings → Payments → "Get paid" card. Stripe Connect (Express) onboarding: links the shop's own
 * bank through Stripe's hosted setup so customers can pay by card and payouts land in the shop's
 * account. No money moves here — this only connects the account. Starting onboarding redirects to
 * Stripe; on the return redirect (?tab=payments&connect=return) we refresh status once. States:
 * Not connected → "Get paid"; Setup started → "Finish setup"; Verifying (Stripe has the details
 * but has not enabled charges — customers CANNOT pay); Connected ✓ (charges enabled).
 * The headline tracks chargesEnabled, never detailsSubmitted: finishing Stripe's form is not the
 * same as being able to charge a card, and the public invoice page gates on the former.
 * In-flow (no floating UI); plain business labels; house .btn classes.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";
import { MarkPayments } from "./setting-marks";

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
    // Keyed on `connect=return` ALONE, not on the tab name. Stripe only ever appends that on its
    // way back from onboarding, and pinning the check to `tab=payments` meant renaming a Settings
    // tab would silently stop refreshing a shop's payout status mid-signup.
    if (params.get("connect") === "return") {
      refresh.mutate();
      params.delete("connect");
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
    // Runs once on mount to consume the Stripe onboarding-return redirect; refresh is stable.
  }, []);

  const s = status.data;
  // THE HEADLINE TRACKS WHETHER MONEY CAN MOVE, not whether a form was finished.
  //
  // This used to read `complete = !!s?.detailsSubmitted` and print "Connected ✓" on that alone,
  // with the fact that matters demoted to a grey sub-line ("Card charges pending"). A real shop sat
  // in exactly that state: the office believed payments were live, while every customer opening an
  // invoice was told to contact them directly — the public page gates its pay block on
  // chargesEnabled, not on detailsSubmitted.
  const live = !!s?.chargesEnabled;
  // Stripe has the shop's details and is still verifying. Connected in Stripe's sense; useless in
  // the only sense that counts.
  const verifying = !!s?.detailsSubmitted && !live;
  const started = !!s && s.hasAccount && !s.detailsSubmitted;

  return (
    <FoldCard
      title="Payments"
      mark={<MarkPayments />}
      summary={live ? "Taking payments" : verifying ? "Verifying" : "Not connected"}
      defaultOpen
    >
      <p style={{ fontSize: "var(--type-base)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        Connect your bank through Stripe so customers can pay you by card. Stripe verifies your
        details and deposits payouts to your account.
      </p>

      {status.isLoading ? (
        <p style={{ fontSize: "var(--type-base)", color: "var(--ink-3)" }}>Loading…</p>
      ) : live || verifying ? (
        <div style={{ fontSize: "var(--type-base)" }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-1)" }}>
            {live ? "Connected ✓" : "Stripe is still verifying your details"}
          </div>
          <div style={{ color: "var(--ink-2)" }}>
            {live ? (
              <>Payouts {s?.payoutsEnabled ? "enabled" : "pending"}</>
            ) : (
              <>
                Customers can&rsquo;t pay yet — an invoice they open says to contact you directly.
                Stripe usually finishes on its own; if it&rsquo;s asking for a document, it&rsquo;s
                in your Stripe dashboard.
              </>
            )}
          </div>
          {/* THE ONLY WAY BACK. Nothing else writes this flag: the refresh call fires on Stripe's
              ?connect=return redirect, which a shop in this state has already been through and
              cannot reach again. Without this button a shop whose charges are enabled an hour
              later stays stuck on "can't pay" forever. */}
          <button
            type="button"
            className="btn sm"
            style={{ marginTop: "var(--space-3)" }}
            disabled={refresh.isPending}
            onClick={() => {
              setError(null);
              refresh.mutate();
            }}
          >
            {refresh.isPending ? "Checking…" : "Check again"}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
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
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }} role="alert">
          {error}
        </p>
      )}
    </FoldCard>
  );
}
