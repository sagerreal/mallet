/**
 * Client island for /pay/success: fire the server-side reconcile with the session_id Stripe
 * substituted into the return URL, then upgrade the copy once the money is verifiably recorded.
 * Graceful by design — the webhook is the PRIMARY recorder, so a missing param, a slow network or
 * a 503 here just leaves the generic success copy standing.
 *
 * Two kinds of money land on this page. `?deposit=` marks the return from a QUOTE DEPOSIT, which
 * settles on the estimate rather than on an invoice — so the copy must not promise the customer an
 * invoice was updated when no invoice exists yet.
 */
"use client";

import { useEffect, useState } from "react";
import { PayResult } from "../pay-result";

export function SuccessConfirm() {
  const [confirmed, setConfirmed] = useState(false);
  // Read from the window rather than useSearchParams: no Suspense boundary needed, and both params
  // are optional anyway (older links carry no session_id). Resolved once on mount; the query string
  // cannot change under this page.
  const [isDeposit, setIsDeposit] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const deposit = params.get("deposit");
    if (deposit) setIsDeposit(true);

    const sessionId = params.get("session_id");
    if (!sessionId || !sessionId.startsWith("cs_")) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/public/pay/reconcile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) return; // the webhook records it — keep the generic copy
        // `recorded: true` is a precise claim from the server: this specific payment is on the
        // ledger (written by this call, or already there under the same payment_intent id from the
        // webhook's delivery). ONLY that upgrades the copy — anything else, including a deposit
        // the estimate could not accept, leaves the neutral wording standing. The money is with
        // Stripe either way; what must never be claimed is that it reached the bill.
        const data = (await res.json()) as { recorded?: boolean };
        if (!cancelled && data.recorded === true) setConfirmed(true);
      } catch {
        // Network failure — same graceful fallback; nothing to surface to the customer.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (isDeposit) return <PayResult variant={confirmed ? "depositConfirmed" : "deposit"} />;
  return <PayResult variant={confirmed ? "confirmed" : "success"} />;
}
