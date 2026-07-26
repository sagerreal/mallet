"use client";

/**
 * Settings → "QuickBooks" card. Connects the shop's QuickBooks Online company so approved crew
 * hours can be sent over instead of being retyped before payroll, and shows what actually
 * happened to each one — the sync log had no reader at all until this card grew one.
 *
 * States: Not configured (server has no Intuit keys) → Not connected → Connected ✓ → Reconnect
 * needed. The connect button navigates the browser to Intuit; the return redirect lands on
 * ?tab=quickbooks&qbo=… which we surface once, then strip so a refresh doesn't repeat it.
 * In-flow (no floating UI); plain business labels; tokens/design-system primitives only.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { FoldCard } from "./fold-card";
import { QuickbooksSetup } from "./quickbooks-setup";
import { QuickbooksActivity } from "./quickbooks-activity";

type Outcome = "connected" | "failed" | "denied";

const OUTCOME_MESSAGE: Record<Outcome, string> = {
  connected: "QuickBooks connected.",
  // Names the likely cause and the next step, rather than "an error occurred".
  failed: "Couldn't finish connecting to QuickBooks. Try again — if it keeps failing, disconnect and start over.",
  denied: "Connection cancelled — nothing changed.",
};

export function QuickbooksCard() {
  const status = api.v1.qbo.status.useQuery();
  const utils = api.useUtils();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const begin = api.v1.qbo.beginConnect.useMutation({
    onError: (e) => setError(e.message || "Couldn't start the connection — try again."),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
  });

  const disconnect = api.v1.qbo.disconnect.useMutation({
    onSuccess: () => {
      setOutcome(null);
      utils.v1.qbo.status.invalidate();
    },
    onError: (e) => setError(e.message || "Couldn't disconnect — try again."),
  });

  // Consume the OAuth return redirect once, then strip the param so a manual refresh doesn't
  // re-show the banner. Mirrors the payments card's connect=return handling.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qbo = params.get("qbo");
    if (qbo === "connected" || qbo === "failed" || qbo === "denied") {
      setOutcome(qbo);
      if (qbo === "connected") utils.v1.qbo.status.invalidate();
      params.delete("qbo");
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
    }
    // Runs once on mount to consume the redirect result.
  }, []);

  const s = status.data;
  const connected = s?.state === "connected";
  const needsReauth = s?.state === "needs_reauth";
  const summary = !s?.configured
    ? "Not set up"
    : connected
      ? "Connected"
      : needsReauth
        ? "Reconnect needed"
        : "Not connected";

  return (
    <FoldCard title="QuickBooks" summary={summary} defaultOpen>
      <p style={{ fontSize: "var(--type-base)", color: "var(--ink-2)", margin: "0 0 var(--space-4)" }}>
        Connect QuickBooks Online so approved crew hours go straight over instead of being typed in
        again before payroll.
      </p>

      {status.isLoading ? (
        <p style={{ fontSize: "var(--type-base)", color: "var(--ink-3)" }} aria-busy="true">
          Loading…
        </p>
      ) : !s?.configured ? (
        // Server-side keys are missing. Say so plainly rather than offering a button that 503s.
        <p style={{ fontSize: "var(--type-base)", color: "var(--ink-2)" }}>
          QuickBooks isn’t set up on this server yet.
        </p>
      ) : connected ? (
        <div style={{ fontSize: "var(--type-base)" }}>
          <div style={{ fontWeight: 700, marginBottom: "var(--space-1)" }}>Connected ✓</div>
          <div style={{ color: "var(--ink-2)" }}>
            Company {s.realmId}
            {s.lastSyncAt ? ` · Last sent ${new Date(s.lastSyncAt).toLocaleDateString()}` : " · Nothing sent yet"}
          </div>
          <div style={{ marginTop: "var(--space-4)" }}>
            <QuickbooksSetup />
          </div>
          {/* Below the setup, because setup is what you fix a failure WITH — reading that someone
              is unmatched is only useful next to the control that matches them. */}
          <div style={{ marginTop: "var(--space-5)" }}>
            <h3 style={{ fontSize: "var(--type-md)", fontWeight: 700, margin: "0 0 var(--space-2)" }}>
              What&apos;s been sent
            </h3>
            <QuickbooksActivity />
          </div>
          <div style={{ marginTop: "var(--space-4)" }}>
            <button
              className="btn quiet"
              disabled={disconnect.isPending}
              onClick={() => {
                setError(null);
                disconnect.mutate();
              }}
            >
              {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          {needsReauth && (
            <div style={{ fontSize: "var(--type-base)", color: "var(--ink-2)" }}>
              QuickBooks stopped accepting the connection. Connect again to fix it.
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
              {begin.isPending ? "Opening QuickBooks…" : needsReauth ? "Reconnect" : "Connect QuickBooks"}
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <p
          style={{
            fontSize: "var(--type-base)",
            color: outcome === "connected" ? "var(--ink-2)" : "var(--red)",
            margin: "var(--space-3) 0 0",
          }}
          role={outcome === "connected" ? undefined : "alert"}
        >
          {OUTCOME_MESSAGE[outcome]}
        </p>
      )}

      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }} role="alert">
          {error}
        </p>
      )}
    </FoldCard>
  );
}
